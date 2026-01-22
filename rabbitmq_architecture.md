# RabbitMQ Posting Architecture

## Infrastructure Diagram
Shows the exchanges, queues, and bindings set up in [index.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/workers/index.ts).

```mermaid
graph TB
    subgraph "EXCHANGES (Mail Sorters)"
        POST_EX["post_exchange<br/>(topic)"]
        DELAYED_EX["post_delayed_exchange<br/>(x-delayed-message)"]
        DLX_EX["dlx_exchange<br/>(direct)"]
    end

    subgraph "QUEUES (Mailboxes)"
        MAIN_Q[("hayon_social_posts<br/>(Main Queue)")]
        RETRY_Q[("hayon_retry_queue<br/>(Waiting Room)")]
        DEAD_Q[("hayon_dead_letters<br/>(Crash Logs)")]
        PARK_Q[("hayon_parking_lot<br/>(Gave Up)")]
    end

    subgraph "BINDINGS (Pipes)"
        POST_EX -->|"post.create.*"| MAIN_Q
        DELAYED_EX -->|"post.create.*"| MAIN_Q
        DLX_EX -->|"retry"| RETRY_Q
        DLX_EX -->|"dead"| DEAD_Q
        DLX_EX -->|"parking"| PARK_Q
    end

    subgraph "DEAD LETTER CONFIGS"
        MAIN_Q -.->|"On NACK/Crash → DLX"| DLX_EX
        RETRY_Q -.->|"On TTL Expire → POST_EX"| POST_EX
    end
```

---

## Full Message Flow (All Cases)

```mermaid
flowchart TD
    subgraph "1. PRODUCER (Controller)"
        A["mastodonController.postToMastodon()"] --> B["producer.queueSocialPost()"]
        B --> C{"Scheduled?"}
        C -->|"No"| D["Publish to POST_EXCHANGE"]
        C -->|"Yes"| E["Publish to DELAYED_EXCHANGE<br/>(with x-delay header)"]
    end

    subgraph "2. RABBITMQ ROUTING"
        D --> F["post_exchange"]
        E --> G["post_delayed_exchange"]
        G -->|"Plugin waits..."| G
        G -->|"Delay expires"| F
        F -->|"RoutingKey: post.create.mastodon"| H[("MAIN QUEUE<br/>hayon_social_posts")]
    end

    subgraph "3. WORKER PROCESSING"
        H --> I["PostWorker.processMessage()"]
        I --> J{"Post Cancelled?"}
        J -->|"Yes"| K["ACK & Skip"]
        J -->|"No"| L{"Already Completed?<br/>(Idempotency)"}
        L -->|"Yes"| K
        L -->|"No"| M["validateCredentials()"]
        M --> N{"Valid?"}
        N -->|"No (401/Fake Token)"| O["DB: status=failed<br/>ACK & Delete"]
        N -->|"Yes"| P["DB: status=processing"]
        P --> Q["getPostingService('mastodon')"]
        Q --> R["MastodonPostingService.execute()"]
    end

    subgraph "4. POSTING RESULT"
        R --> S{"Success?"}
        S -->|"Yes"| T["DB: status=completed<br/>ACK & Delete"]
        S -->|"No"| U{"Rate Limited?"}
        U -->|"Yes"| V["Throw Error → Retry Path"]
        U -->|"No (Permanent)"| W["DB: status=failed<br/>ACK & Delete"]
    end

    subgraph "5. ERROR HANDLING (Catch Block)"
        V --> X["isRetryableError()"]
        X --> Y{"Retryable?"}
        Y -->|"No"| Z["DB: status=failed<br/>ACK & Delete"]
        Y -->|"Yes"| AA["handleDeadLetter()"]
        AA --> AB{"retryCount > 3?"}
        AB -->|"No"| AC["Publish to DLX_EXCHANGE<br/>RoutingKey: retry<br/>TTL: 5s/30s/2m"]
        AB -->|"Yes"| AD["Publish to DLX_EXCHANGE<br/>RoutingKey: parking"]
        AC --> AE[("RETRY QUEUE")]
        AD --> AF[("PARKING LOT")]
    end

    subgraph "6. RETRY LOOP"
        AE -->|"Wait for TTL..."| AE
        AE -->|"TTL Expires (Dies)"| AG["Dead Letter Config Triggers"]
        AG -->|"Redirect to POST_EXCHANGE"| F
    end

    subgraph "7. WORKER CRASH (RabbitMQ Auto)"
        I -->|"Worker Crashes / Fatal Error"| AH["RabbitMQ: Unacked Message"]
        AH -->|"deadLetterExchange config"| AI["Publish to DLX_EXCHANGE<br/>RoutingKey: dead"]
        AI --> AJ[("DEAD LETTER QUEUE")]
    end
```

---

## Function Reference Table

| Step | File | Function | What it Does |
|:---|:---|:---|:---|
| 1 | [mastodon.controller.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/controllers/platforms/mastodon.controller.ts) | [postToMastodon()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/controllers/platforms/mastodon.controller.ts#112-167) | Creates Post in DB, calls producer |
| 2 | [producer.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/lib/queues/producer.ts) | [queueSocialPost()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/lib/queues/producer.ts#48-76) | Publishes to exchange |
| 3 | [index.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/workers/index.ts) | [startWorker()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/workers/index.ts#7-149) | Sets up all exchanges/queues/bindings |
| 4 | [post.worker.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/workers/post.worker.ts) | [processMessage()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/workers/post.worker.ts#68-236) | Main worker logic |
| 5 | [posting/index.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/services/posting/index.ts) | [validateCredentials()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/services/posting/index.ts#60-76) | Checks if token is valid |
| 6 | [posting/index.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/services/posting/index.ts) | [getPostingService()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/services/posting/index.ts#20-27) | Factory for platform service |
| 7 | [mastodon.posting.service.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/services/posting/mastodon.posting.service.ts) | [execute()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/services/posting/base.posting.service.ts#70-99) | Calls Mastodon API |
| 8 | [post.worker.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/workers/post.worker.ts) | [isRetryableError()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/workers/post.worker.ts#48-66) | Decides retry vs permanent |
| 9 | [dlx.setup.ts](file:///home/hafeez/projects/project_hayon/hayon/backend/src/lib/queues/dlx.setup.ts) | [handleDeadLetter()](file:///home/hafeez/projects/project_hayon/hayon/backend/src/lib/queues/dlx.setup.ts#57-100) | Sends to retry/parking |

---

## Routing Key Legend

| Key | Source | Destination | Meaning |
|:---|:---|:---|:---|
| `post.create.mastodon` | Producer | Main Queue | New post for Mastodon |
| [retry](file:///home/hafeez/projects/project_hayon/hayon/backend/src/controllers/post.controller.ts#74-85) | Worker | Retry Queue | Network error, try later |
| `dead` | RabbitMQ | Dead Letter Queue | Worker crashed |
| `parking` | Worker | Parking Lot | Max retries reached |

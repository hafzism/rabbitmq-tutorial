# Hayon Social Media Posting Architecture Masterclass

## Table of Contents

1. [System Overview](#1-system-overview)
2. [User Journey](#2-user-journey)
3. [Frontend Architecture](#3-frontend-architecture)
4. [API Layer](#4-api-layer)
5. [Database Design](#5-database-design)
6. [RabbitMQ Deep Dive](#6-rabbitmq-deep-dive)
7. [Worker Architecture](#7-worker-architecture)
8. [Platform API Integrations](#8-platform-api-integrations)
9. [S3 Media Handling](#9-s3-media-handling)
10. [Error Handling & Edge Cases](#10-error-handling--edge-cases)
11. [Complete Request Lifecycle](#11-complete-request-lifecycle)

---

## 1. System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HAYON ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────────────┐   │
│  │ FRONTEND │────▶│   API    │────▶│ RABBITMQ │────▶│     WORKERS      │   │
│  │ (Next.js)│     │ (Express)│     │ (Queue)  │     │ (Separate Process)│   │
│  └──────────┘     └────┬─────┘     └──────────┘     └────────┬─────────┘   │
│                        │                                      │             │
│                        ▼                                      ▼             │
│                   ┌─────────┐                          ┌──────────────┐     │
│                   │ MONGODB │◀─────────────────────────│   PLATFORM   │     │
│                   │   (DB)  │                          │     APIS     │     │
│                   └────┬────┘                          └──────────────┘     │
│                        │                                                     │
│                        ▼                                                     │
│                   ┌─────────┐                                               │
│                   │   S3    │                                               │
│                   │ (Media) │                                               │
│                   └─────────┘                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

**Decoupling**: The API server and workers are separate processes. This means:
- API responds quickly (doesn't wait for slow platform APIs)
- Workers can be scaled independently
- Failures in one don't crash the other

**Reliability**: RabbitMQ provides:
- Message persistence (survives restarts)
- Delivery guarantees (messages don't get lost)
- Dead letter queues (failed messages are preserved)

**Scalability**: Multiple workers can process messages concurrently from the same queue.

---

## 2. User Journey

### From User's Perspective

```
1. User opens Create Post page
         │
         ▼
2. User writes caption: "Check out my new project! 🚀"
         │
         ▼
3. User uploads 3 images (drag & drop)
         │
         ▼
4. User sees 6 platforms, 4 connected:
   ✅ Bluesky  ✅ Threads  ✅ Facebook  ✅ Mastodon
   ❌ Instagram (not connected)  ❌ Tumblr (not connected)
         │
         ▼
5. User selects only Bluesky and Threads (deselects Facebook, Mastodon)
         │
         ▼
6. User clicks "Generate Posts"
         │
         ▼
7. User sees preview for each selected platform
   - Can edit caption per platform
   - Can remove images for specific platform
         │
         ▼
8. User clicks "Post Now" OR schedules for later
         │
         ▼
9. User sees success message: "Your post is being published!"
         │
         ▼
10. (Behind scenes: Worker processes each platform)
         │
         ▼
11. Post appears on Bluesky and Threads
```

### Key User Decisions

| Decision | Impact |
|----------|--------|
| Platform selection | Only selected platforms get queued |
| Per-platform caption edit | Each platform gets different text if edited |
| Schedule time | Message goes to delayed exchange |
| Post now | Message goes directly to queue |

---

## 3. Frontend Architecture

### File Structure

```
frontend/
├── src/
│   ├── app/(user)/dashboard/create-post/
│   │   └── page.tsx                 # Main page component
│   ├── components/create-post/
│   │   ├── CreatePostForm.tsx       # Text input, media upload
│   │   ├── PlatformSelection.tsx    # Platform checkboxes
│   │   ├── PostPreview.tsx          # Per-platform previews
│   │   ├── EditPlatformPostModal.tsx
│   │   └── SchedulePostDialog.tsx
│   ├── hooks/
│   │   └── useCreatePost.ts         # All state management
│   └── types/
│       └── create-post.ts           # TypeScript interfaces
```

### State Flow in useCreatePost.ts

```typescript
// Core State
postText: string                    // Global caption
mediaFiles: File[]                  // Uploaded files (not yet in S3)
filePreviews: string[]              // Object URLs for preview

// Platform State
availablePlatforms: Platform[]      // All 6 platforms with connection status
selectedPlatforms: string[]         // User's selections (e.g., ['bluesky', 'threads'])
connectedAccounts: SocialAccount    // From /api/platform/find

// Per-Platform Customization
platformPosts: Record<string, {
  text: string,                     // Custom caption for this platform
  mediaFiles: File[],               // Custom media subset
  filePreviews: string[]
}>

// Schedule State
scheduleDate: string                // "2025-01-20"
scheduleTime: string                // "14:30"
timeZone: string                    // "Asia/Kolkata"
```

### Platform Selection Logic

```typescript
// When user toggles a platform
const togglePlatform = (id: string, connected: boolean) => {
  // Can't select disconnected platforms
  if (!connected) return;
  
  setSelectedPlatforms((prev) =>
    prev.includes(id) 
      ? prev.filter((p) => p !== id)  // Remove if already selected
      : [...prev, id]                  // Add if not selected
  );
};
```

### Generate Posts Flow

```typescript
const handleGeneratePosts = async () => {
  // 1. Validate: At least one platform selected
  if (selectedPlatforms.length === 0) return;
  
  // 2. Validate per-platform constraints
  if (!validatePost()) return;
  
  // 3. Initialize platform-specific posts with global data
  const initialPlatformPosts = {};
  selectedPlatforms.forEach((id) => {
    initialPlatformPosts[id] = {
      text: postText,           // Copy global caption
      mediaFiles: [...mediaFiles],
      filePreviews: [...filePreviews],
    };
  });
  setPlatformPosts(initialPlatformPosts);
  
  // 4. Switch to preview mode
  setViewMode("preview");
};
```

### Submit Flow (TODO in your code)

```typescript
const handlePostNow = async () => {
  // STEP 1: Upload media to S3 (if not already uploaded)
  // Each file -> POST /api/upload or use presigned URLs
  // Returns S3 keys like "posts/user123/abc123.jpg"
  
  // STEP 2: Build request payload
  const payload = {
    content: {
      text: postText,
      mediaKeys: s3Keys,  // From step 1
    },
    platforms: selectedPlatforms.map(id => ({
      platform: id,
      text: platformPosts[id]?.text || postText,
      mediaKeys: platformPosts[id]?.mediaKeys || s3Keys,
    })),
    scheduledAt: scheduleDate && scheduleTime
      ? `${scheduleDate}T${scheduleTime}:00.000Z`
      : undefined,
  };
  
  // STEP 3: Call API
  const response = await api.post('/posts/create', payload);
  
  // STEP 4: Handle response
  // response.data.postId -> Save for status tracking
};
```

---

## 4. API Layer

### Route Registration

```typescript
// app.ts
import postRoutes from './routes/post.routes';
app.use('/api/posts', postRoutes);
```

### Routes Definition

```typescript
// routes/post.routes.ts
router.post('/create', authenticate, PostController.createPost);
router.get('/', authenticate, PostController.getPosts);
router.get('/:id', authenticate, PostController.getPost);
router.delete('/:id', authenticate, PostController.deletePost);
```

### Controller Flow: POST /api/posts/create

```typescript
// controllers/post.controller.ts

static async createPost(req: Request, res: Response) {
  // 1. VALIDATE REQUEST
  // Zod schema ensures:
  // - content.text is non-empty
  // - platforms array has at least 1 item
  // - each platform has valid name and text
  // - scheduledAt is valid ISO date if present
  
  // 2. VERIFY PLATFORM CONNECTIONS
  const socialAccount = await SocialAccountModel.findOne({ userId });
  
  // Check each requested platform is actually connected
  for (const p of platforms) {
    if (!socialAccount[p.platform]?.connected) {
      return res.status(400).json({
        error: `Platform ${p.platform} is not connected`
      });
    }
  }
  
  // 3. CREATE POST DOCUMENT
  // Status starts as QUEUED (or SCHEDULED if scheduledAt present)
  const post = await PostModel.create({
    userId,
    content,
    isScheduled: !!scheduledAt,
    scheduledAt,
    platformPosts: platforms.map(p => ({
      platform: p.platform,
      text: p.text,
      mediaKeys: p.mediaKeys,
      status: scheduledAt ? 'SCHEDULED' : 'QUEUED',
      retryCount: 0,
    })),
  });
  
  // 4. QUEUE MESSAGES FOR EACH PLATFORM
  // This is the critical async handoff!
  for (const platformData of platforms) {
    await Producer.queueSocialPost({
      postId: post._id.toString(),
      userId: userId,
      platform: platformData.platform,
      content: {
        text: platformData.text,
        mediaUrls: await getS3Urls(platformData.mediaKeys),
      },
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    });
  }
  
  // 5. RESPOND IMMEDIATELY
  // Don't wait for platforms - that's the worker's job
  return res.status(201).json({
    success: true,
    postId: post._id,
    status: scheduledAt ? 'SCHEDULED' : 'QUEUED',
    platformCount: platforms.length,
  });
}
```

### Why Respond Before Processing?

Platform APIs are slow and unreliable:
- Bluesky: 200-500ms
- Meta (Threads/Instagram): 1-5 seconds (container polling)
- Tumblr: 500ms-2s

If we waited: User waits 10-15 seconds, HTTP timeout risk, poor UX.

With async: User gets response in ~100ms, actual posting happens in background.

---

## 5. Database Design

### Post Model Schema

```typescript
// models/post.model.ts

const Post = {
  _id: ObjectId,
  userId: ObjectId,           // Who created this post
  
  // Original content (as submitted)
  content: {
    text: String,             // Global caption
    mediaKeys: [String],      // S3 keys: ["posts/user1/img1.jpg"]
  },
  
  // Per-platform tracking (one entry per selected platform)
  platformPosts: [{
    platform: String,         // "bluesky", "threads", etc.
    text: String,             // Platform-specific caption
    mediaKeys: [String],      // Platform-specific media subset
    
    // Status lifecycle
    status: {
      type: String,
      enum: [
        'PENDING',            // Just created
        'QUEUED',             // In RabbitMQ queue
        'SCHEDULED',          // Waiting for scheduled time
        'PUBLISHING',         // Worker is processing
        'PUBLISHED',          // Successfully posted
        'FAILED',             // All retries exhausted
      ]
    },
    
    // Result data
    platformPostId: String,   // ID from social network (for linking)
    publishedAt: Date,        // When it was actually posted
    
    // Error tracking
    error: String,            // Last error message
    retryCount: Number,       // How many times we've tried
  }],
  
  // Scheduling
  isScheduled: Boolean,
  scheduledAt: Date,
  
  // Timestamps
  createdAt: Date,
  updatedAt: Date,
}
```

### Status Transitions

```
                    ┌─────────────┐
                    │   PENDING   │
                    └──────┬──────┘
                           │ (API creates post, queues message)
                           ▼
              ┌────────────────────────┐
              │                        │
              ▼                        ▼
       ┌──────────┐            ┌───────────┐
       │  QUEUED  │            │ SCHEDULED │
       └────┬─────┘            └─────┬─────┘
            │                        │
            │ (worker picks up)      │ (delay expires)
            ▼                        ▼
       ┌───────────────────────────────┐
       │         PUBLISHING            │
       └───────────────┬───────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
    ┌──────────┐              ┌──────────┐
    │PUBLISHED │              │  FAILED  │
    └──────────┘              └──────────┘
```

### SocialAccount Model (Already Exists)

```typescript
// models/socialAccount.model.ts

const SocialAccount = {
  userId: ObjectId,
  
  // Each platform has same structure
  bluesky: {
    connected: Boolean,
    did: String,                    // Bluesky user ID
    profile: { handle, displayName, avatar },
    auth: {
      accessJwt: String,            // For API calls
      refreshJwt: String,           // For token refresh
    },
    health: { status, lastError },
  },
  
  facebook: {
    connected: Boolean,
    platformId: String,             // Page ID
    profile: { handle, displayName, avatar },
    auth: {
      accessToken: String,          // Page access token
      expiresAt: Date,
    },
    health: { ... },
  },
  
  // Similar for: instagram, threads, mastodon, tumblr
}
```

---

## 6. RabbitMQ Deep Dive

### Core Concepts

**Exchange**: Message router. Receives messages from producers, routes to queues.

**Queue**: Message buffer. Stores messages until consumed.

**Binding**: Rules connecting exchanges to queues (routing patterns).

**Message**: Data packet with headers and body.

### Your Exchange/Queue Setup

```
                          EXCHANGES
                              │
         ┌────────────────────┴────────────────────┐
         │                                         │
         ▼                                         ▼
┌─────────────────┐                    ┌────────────────────────┐
│  post_exchange  │                    │ post_delayed_exchange  │
│   (type: topic) │                    │ (type: x-delayed-message)
└────────┬────────┘                    └───────────┬────────────┘
         │                                         │
         │ routing: post.create.*                  │ routing: post.create.*
         │                                         │
         └──────────────────┬──────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │   hayon_social_posts  │
                │       (queue)         │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │   dlx_exchange (DLQ)  │
                │   (dead letter queue) │
                └───────────────────────┘
```

### Message Structure

```typescript
// lib/queues/types.ts

interface PostQueueMessage {
  // Tracking
  postId: string;           // MongoDB _id
  correlationId: string;    // UUID for tracing logs
  timestamp: Date;          // When queued
  
  // Targeting
  userId: string;           // Who owns this post
  platform: string;         // Which platform to post to
  
  // Content
  content: {
    text: string;           // Caption text
    mediaUrls: string[];    // Full S3 URLs (not keys!)
  };
  
  // Scheduling
  scheduledAt?: Date;       // When to post (if scheduled)
  
  // Retry tracking
  retryCount: number;       // 0, 1, 2, then fail
}
```

### Producer: Sending Messages

```typescript
// lib/queues/producer.ts

class Producer {
  static async queueSocialPost(data) {
    const correlationId = uuidv4();
    
    // Build full message
    const message = {
      ...data,
      timestamp: new Date(),
      correlationId,
    };
    
    // Calculate delay for scheduled posts
    let delay;
    if (data.scheduledAt) {
      delay = new Date(data.scheduledAt).getTime() - Date.now();
      if (delay < 0) delay = 0;  // Already passed, post now
    }
    
    // Choose exchange based on delay
    const exchange = delay 
      ? EXCHANGES.POST_DELAYED_EXCHANGE 
      : EXCHANGES.POST_EXCHANGE;
    
    // Routing key includes platform for potential future filtering
    const routingKey = `post.create.${data.platform}`;
    
    // Publish with options
    channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
      persistent: true,      // Survives RabbitMQ restart
      contentType: 'application/json',
      headers: delay ? { 'x-delay': delay } : undefined,
    });
    
    return correlationId;
  }
}
```

### Delayed Message Exchange

The `rabbitmq_delayed_message_exchange` plugin enables scheduling.

**How it works:**
1. Message arrives with `x-delay: 300000` header (5 minutes)
2. Exchange holds the message internally
3. After 5 minutes, routes to bound queue
4. Worker picks it up

**Setup required:**
```bash
# Must enable plugin first!
rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

**Exchange declaration:**
```typescript
await channel.assertExchange('post_delayed_exchange', 'x-delayed-message', {
  durable: true,
  arguments: { 'x-delayed-type': 'topic' }  // Underlying routing type
});
```

### Message Acknowledgment

```typescript
// In worker
channel.consume(queue, async (msg) => {
  try {
    await processMessage(msg);
    channel.ack(msg);           // ✅ Success: remove from queue
  } catch (error) {
    if (shouldRetry(error)) {
      // Requeue with delay
      await requeueWithDelay(msg);
      channel.ack(msg);         // Ack original (we've requeued)
    } else {
      channel.nack(msg, false, false);  // ❌ Send to DLQ
    }
  }
});
```

### Dead Letter Queue (DLQ)

Messages that fail permanently go to DLQ for:
- Manual inspection
- Retry later
- Alerting/monitoring

```typescript
// Queue setup with DLQ
await channel.assertQueue('hayon_social_posts', {
  durable: true,
  deadLetterExchange: 'dlx_exchange',  // Where failed msgs go
});

// DLQ setup
await channel.assertExchange('dlx_exchange', 'topic', { durable: true });
await channel.assertQueue('failed_posts', { durable: true });
await channel.bindQueue('failed_posts', 'dlx_exchange', '#');
```

---

## 7. Worker Architecture

### Worker as Separate Process

```
┌─────────────────┐         ┌─────────────────┐
│   API SERVER    │         │     WORKER      │
│                 │         │                 │
│  npm run dev    │         │  npm run worker │
│  Port 5000      │         │  No port        │
│                 │         │                 │
│  Handles HTTP   │         │  Handles Queue  │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │                           │
         ▼                           ▼
    ┌─────────┐               ┌───────────┐
    │ MongoDB │◀──────────────│  MongoDB  │
    └─────────┘               └───────────┘
         │                           │
         ▼                           ▼
    ┌──────────┐              ┌──────────┐
    │ RabbitMQ │─────────────▶│ RabbitMQ │
    └──────────┘              └──────────┘
```

### Worker Startup Flow

```typescript
// workers/index.ts

async function startWorker() {
  // 1. Connect to MongoDB (separate connection from API)
  await connectDatabase();
  
  // 2. Connect to RabbitMQ
  await connectRabbitMQ();
  const channel = getChannel();
  
  // 3. Setup exchanges
  await channel.assertExchange('post_exchange', 'topic', { durable: true });
  await channel.assertExchange('post_delayed_exchange', 'x-delayed-message', {
    durable: true,
    arguments: { 'x-delayed-type': 'topic' }
  });
  
  // 4. Setup DLQ
  await channel.assertExchange('dlx_exchange', 'topic', { durable: true });
  await channel.assertQueue('failed_posts', { durable: true });
  await channel.bindQueue('failed_posts', 'dlx_exchange', '#');
  
  // 5. Setup main queue with DLQ binding
  await channel.assertQueue('hayon_social_posts', {
    durable: true,
    deadLetterExchange: 'dlx_exchange',
  });
  
  // 6. Bind queues to exchanges
  await channel.bindQueue('hayon_social_posts', 'post_exchange', 'post.create.*');
  await channel.bindQueue('hayon_social_posts', 'post_delayed_exchange', 'post.create.*');
  
  // 7. Set prefetch (one message at a time per worker)
  await channel.prefetch(1);
  
  // 8. Start consuming
  channel.consume('hayon_social_posts', async (msg) => {
    if (msg) await PostWorker.processMessage(msg, channel);
  });
  
  // 9. Graceful shutdown
  process.on('SIGTERM', async () => {
    await channel.cancel(consumerTag);
    await closeRabbitMQ();
    await mongoose.disconnect();
    process.exit(0);
  });
}
```

### Message Processing Flow

```typescript
// workers/post.worker.ts

class PostWorker {
  static async processMessage(msg, channel) {
    const payload = JSON.parse(msg.content.toString());
    
    // 1. UPDATE STATUS: QUEUED -> PUBLISHING
    await PostModel.updateOne(
      { _id: payload.postId, 'platformPosts.platform': payload.platform },
      { $set: { 'platformPosts.$.status': 'PUBLISHING' } }
    );
    
    // 2. FETCH AUTH TOKENS
    const socialAccount = await SocialAccountModel.findOne({ userId: payload.userId });
    const platformAuth = socialAccount[payload.platform]?.auth;
    
    // Edge case: Account disconnected since queueing
    if (!socialAccount[payload.platform]?.connected) {
      throw new Error('ACCOUNT_DISCONNECTED');
    }
    
    // 3. CALL PLATFORM API
    let platformPostId;
    switch (payload.platform) {
      case 'bluesky':
        platformPostId = await blueskyService.createPost(payload.content, platformAuth);
        break;
      case 'threads':
        platformPostId = await threadsService.createPost(payload.content, platformAuth);
        break;
      // ... other platforms
    }
    
    // 4. UPDATE STATUS: PUBLISHING -> PUBLISHED
    await PostModel.updateOne(
      { _id: payload.postId, 'platformPosts.platform': payload.platform },
      { 
        $set: { 
          'platformPosts.$.status': 'PUBLISHED',
          'platformPosts.$.platformPostId': platformPostId,
          'platformPosts.$.publishedAt': new Date(),
        } 
      }
    );
    
    // 5. ACK MESSAGE
    channel.ack(msg);
  }
}
```

---

## 8. Platform API Integrations

### Platform Comparison

| Platform | Auth Type | Media Upload | Polling Required | Text Limit |
|----------|-----------|--------------|------------------|------------|
| Bluesky | JWT Session | Upload bytes | No | 300 |
| Threads | OAuth 2.0 | Public URL | Yes (container) | 500 |
| Facebook | Page Token | URL or bytes | No | 63,206 |
| Instagram | OAuth 2.0 | Public URL only! | Yes (container) | 2,200 |
| Mastodon | Bearer Token | Upload bytes | Video only | 500* |
| Tumblr | OAuth 1.0a | URL or base64 | No | 4,096 |

*Varies by instance

### Bluesky Posting

```typescript
// Simplest API - direct posting

async function createPostBluesky(content, auth) {
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.resumeSession(auth);
  
  // Upload images first (required for embedding)
  const blobs = [];
  for (const url of content.mediaUrls) {
    const imageBuffer = await downloadFromS3(url);
    
    // CONSTRAINT: Max 1MB per image
    if (imageBuffer.length > 1_000_000) {
      throw new Error('Image exceeds 1MB limit');
    }
    
    const result = await agent.uploadBlob(imageBuffer, { encoding: 'image/jpeg' });
    blobs.push(result.data.blob);
  }
  
  // Create post with embedded images
  const postResult = await agent.post({
    text: content.text,
    createdAt: new Date().toISOString(),
    embed: blobs.length > 0 ? {
      $type: 'app.bsky.embed.images',
      images: blobs.map((blob, i) => ({
        image: blob,
        alt: content.altTexts?.[i] || '',
      })),
    } : undefined,
  });
  
  return { uri: postResult.uri, cid: postResult.cid };
}
```

### Threads Posting (2-Step Container)

```typescript
async function createPostThreads(content, auth) {
  const GRAPH_URL = 'https://graph.threads.net';
  
  // STEP 1: Create container
  const containerResponse = await axios.post(
    `${GRAPH_URL}/${auth.userId}/threads`,
    content.mediaUrls.length > 0 ? {
      media_type: 'IMAGE',
      image_url: content.mediaUrls[0],  // Must be publicly accessible!
      text: content.text,
      access_token: auth.accessToken,
    } : {
      media_type: 'TEXT',
      text: content.text,
      access_token: auth.accessToken,
    }
  );
  const containerId = containerResponse.data.id;
  
  // STEP 2: Poll until FINISHED
  let status = 'IN_PROGRESS';
  while (status !== 'FINISHED') {
    await sleep(1500);  // Wait 1.5 seconds
    const statusResponse = await axios.get(
      `${GRAPH_URL}/${containerId}`,
      { params: { fields: 'status', access_token: auth.accessToken } }
    );
    status = statusResponse.data.status;
    
    if (status === 'ERROR') {
      throw new Error('Container processing failed');
    }
  }
  
  // STEP 3: Publish
  const publishResponse = await axios.post(
    `${GRAPH_URL}/${auth.userId}/threads_publish`,
    { creation_id: containerId, access_token: auth.accessToken }
  );
  
  return { id: publishResponse.data.id };
}
```

### Instagram Critical Constraint

```
⚠️ INSTAGRAM REQUIRES PUBLICLY ACCESSIBLE URLS ⚠️

Instagram's API does NOT accept file uploads.
It will cURL the image from the URL you provide.

Options:
1. Make S3 bucket public (security risk)
2. Use S3 signed URLs with long expiry (1+ hour)
3. Use CloudFront with signed URLs

Your S3 bucket is likely private, so you MUST implement:
s3Service.getSignedUrl(key, expiresIn: 3600)
```

---

## 9. S3 Media Handling

### Upload Flow (Frontend -> S3)

```
User Selects Files
       │
       ▼
Files stored in React state (mediaFiles: File[])
       │
       ▼
On Submit: Upload to S3
       │
       ▼
Option A: Direct Upload via Presigned URL
  1. Frontend calls: GET /api/upload/presign?filename=photo.jpg
  2. Backend returns: { uploadUrl, key }
  3. Frontend: PUT to uploadUrl with file
  4. Frontend saves key for submission

Option B: Multipart through Backend
  1. Frontend: POST /api/upload with FormData
  2. Backend: s3.uploadFile(key, buffer, contentType)
  3. Backend returns: { key }
```

### Platform-Specific S3 Usage

| Platform | Needs URL | Needs Bytes | Method |
|----------|-----------|-------------|--------|
| Bluesky | ❌ | ✅ | downloadFile() |
| Mastodon | ❌ | ✅ | downloadFile() |
| Threads | ✅ (public) | ❌ | getSignedUrl() |
| Instagram | ✅ (public) | ❌ | getSignedUrl() |
| Facebook | ✅ (accepts URL) | ❌ | getSignedUrl() |
| Tumblr | ✅ or base64 | Optional | Either |

### S3 Methods Needed

```typescript
class S3Service {
  // Already exists - upload file
  async uploadFile(key, buffer, contentType) { ... }
  
  // TODO: Get signed URL for Instagram/Threads
  async getSignedUrl(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }
  
  // TODO: Download for Bluesky/Mastodon
  async downloadFile(key) {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    const response = await this.s3Client.send(command);
    return Buffer.from(await response.Body.transformToByteArray());
  }
}
```

---

## 10. Error Handling & Edge Cases

### Error Categories

| Category | Example | Action |
|----------|---------|--------|
| AUTH_ERROR | 401, token expired | Don't retry, mark for reconnection |
| RATE_LIMIT | 429 from platform | Retry with longer delay |
| MEDIA_ERROR | Image too large | Don't retry, fail gracefully |
| API_ERROR | 500 from platform | Retry with exponential backoff |
| NETWORK_ERROR | Timeout | Retry with backoff |

### Retry Logic

```typescript
const MAX_RETRIES = 3;

async function processWithRetry(msg, channel) {
  const payload = JSON.parse(msg.content.toString());
  
  try {
    await processMessage(payload);
    channel.ack(msg);
  } catch (error) {
    // Categorize error
    const errorType = categorizeError(error);
    
    if (errorType === 'AUTH_ERROR') {
      // Don't retry - mark account for reconnection
      await markAccountUnhealthy(payload.userId, payload.platform);
      await updatePostStatus(payload.postId, payload.platform, 'FAILED', error.message);
      channel.ack(msg);  // Don't send to DLQ
      return;
    }
    
    if (payload.retryCount < MAX_RETRIES && shouldRetry(errorType)) {
      // Exponential backoff: 2s, 4s, 8s
      const delay = Math.pow(2, payload.retryCount + 1) * 1000;
      
      // Requeue with delay
      await Producer.publish(
        EXCHANGES.POST_DELAYED_EXCHANGE,
        `post.create.${payload.platform}`,
        { ...payload, retryCount: payload.retryCount + 1 },
        { delay }
      );
      
      channel.ack(msg);  // Ack original
    } else {
      // Max retries exceeded - fail permanently
      await updatePostStatus(payload.postId, payload.platform, 'FAILED', error.message);
      channel.nack(msg, false, false);  // Send to DLQ
    }
  }
}
```

### Edge Cases Checklist

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| User selects 0 platforms | Frontend validation | Block submit |
| Platform disconnected after queueing | Check connected flag in worker | Fail gracefully |
| Token expired during processing | 401 response | Mark unhealthy, don't retry |
| Image > size limit | Check before upload | Resize or reject |
| Scheduled time in past | `delay < 0` | Post immediately |
| Worker crashes mid-processing | Message not acked | Re-delivered on restart |
| Same message processed twice | Idempotency check | Use correlationId |
| One platform fails in multi-post | Independent processing | Others still succeed |
| Caption too long for platform | Frontend + backend validation | Truncate or reject |

### Partial Success Handling

```
User posts to 3 platforms:
├── Bluesky  ✅ PUBLISHED
├── Threads  ❌ FAILED (rate limited)
└── Facebook ✅ PUBLISHED

Result: 2/3 successful

Post.platformPosts = [
  { platform: 'bluesky', status: 'PUBLISHED', platformPostId: '...' },
  { platform: 'threads', status: 'FAILED', error: 'Rate limited' },
  { platform: 'facebook', status: 'PUBLISHED', platformPostId: '...' },
]
```

---

## 11. Complete Request Lifecycle

### Timeline View

```
T+0ms     User clicks "Post Now"
          │
T+5ms     │ Frontend: handlePostNow() called
          │ - Validates form
          │ - Prepares payload
          │
T+50ms    │ Frontend: POST /api/posts/create
          │
T+55ms    │ Backend: Request received
          │ - Auth middleware validates JWT
          │ - Zod validates request body
          │
T+80ms    │ Backend: Verify platform connections
          │ - Query SocialAccountModel
          │ - Check connected flags
          │
T+120ms   │ Backend: Create Post document
          │ - Insert into MongoDB
          │ - Status: QUEUED for each platform
          │
T+150ms   │ Backend: Queue messages (one per platform)
          │ - Producer.queueSocialPost() x N
          │ - Each message to post_exchange
          │
T+180ms   │ Backend: Send response
          │ - { success: true, postId: '...' }
          │
T+200ms   │ Frontend: Show success message
          │ - "Your post is being published!"
          │
T+250ms   │ Worker: Picks up message #1 (Bluesky)
          │ - Update status: PUBLISHING
          │ - Fetch auth tokens
          │ - Download images from S3
          │ - Upload blobs to Bluesky
          │ - Create post
          │
T+800ms   │ Worker: Bluesky complete
          │ - Update status: PUBLISHED
          │ - Store platformPostId
          │ - Ack message
          │
T+850ms   │ Worker: Picks up message #2 (Threads)
          │ - Update status: PUBLISHING
          │ - Create container
          │ - Poll status...
          │
T+4000ms  │ Worker: Threads container ready
          │ - Publish container
          │ - Update status: PUBLISHED
          │ - Ack message
          │
T+4050ms  Workers idle, all messages processed
          │
T+???     │ User refreshes dashboard
          │ - Sees post with all platforms PUBLISHED
```

### Developer Checklist for Implementation

```
□ RabbitMQ
  □ Install delayed message plugin
  □ Start RabbitMQ server
  □ Add RABBITMQ_URL to .env

□ Database
  □ Implement Post model schema
  □ Add indexes for efficient queries

□ API
  □ Implement post.controller.ts
  □ Register routes in app.ts
  □ Add Zod validation schema

□ S3
  □ Implement getSignedUrl()
  □ Implement downloadFile()
  □ Test URL accessibility

□ Worker
  □ Add npm script: "worker": "ts-node src/workers/index.ts"
  □ Test worker starts and connects
  □ Verify exchange/queue creation

□ Platform Services
  □ Bluesky: Implement createPost
  □ Threads: Implement createPost with polling
  □ Facebook: Implement createPost
  □ Instagram: Implement createPost (signed URLs!)
  □ Mastodon: Implement createPost (multipart)
  □ Tumblr: Implement createPost (OAuth 1.0a)

□ Frontend
  □ Implement S3 upload before submit
  □ Call POST /api/posts/create
  □ Handle response and show status

□ Testing
  □ Unit tests for each service
  □ Integration test: full flow
  □ Test error scenarios
  □ Test scheduled posts
```

---

## Summary

This architecture separates concerns:

1. **Frontend**: Handles UI, validation, user experience
2. **API**: Handles auth, validation, persistence, queueing
3. **RabbitMQ**: Handles async delivery, scheduling, reliability
4. **Workers**: Handle slow platform APIs, retries, status updates
5. **Platforms**: Each has unique requirements handled independently

The key insight: **Never make the user wait for slow external APIs.**

Queue immediately, respond fast, process in background.

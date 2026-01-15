import dotenv from "dotenv";
import { connectRabbit } from "../queue/rabbit.js";

dotenv.config();

// ============================================================================
// THE CONSUMER (The Worker / The Cook)
// ============================================================================
// This script runs forever. It watches the Queue.
// When a message appears, it grabs it, does the work, and tells RabbitMQ "Done!".
// ============================================================================

async function startWorker() {
  try {
    // 1. Connect
    const { channel } = await connectRabbit();
    const queueName = "post_tasks";

    // 2. Assert Queue (Again)
    // Why again? To be safe. If the Worker starts BEFORE the API (Producer),
    // we want to make sure the queue exists so we don't crash.
    await channel.assertQueue(queueName, { durable: true });

    // 3. Prefetch (Flow Control)
    // This tells RabbitMQ: "Only give me 1 job at a time."
    // Don't overwhelm me with 100 jobs if I'm slow.
    // Give me 1, wait for me to acknowledge (ack) it, then give me the next.
    channel.prefetch(1);

    console.log(`👷 Worker is running! Waiting for messages in '${queueName}'...`);

    // 4. Consume (The Loop)
    // This function triggers whenever a message is available.
    channel.consume(queueName, async (msg) => {
      if (msg !== null) {
        // A. Parse content from Buffer to JSON
        const data = JSON.parse(msg.content.toString());

        console.log("-----------------------------------------");
        console.log("🔥 [Worker] Received job:", data);

        // B. Do the Heavy Lifting
        // Try/Catch is crucial here. If the logic fails, we don't want the worker to crash.
        try {
          // Fake processing (e.g., uploading to Instagram)
          console.log("   ... Processing (Uploading to " + data.platform + ")...");
          await new Promise((res) => setTimeout(res, 2000)); // Simulate 2s work

          console.log("✅ [Worker] Job Completed!");

          // C. Acknowledge (ACK) !!! SUPER IMPORTANT !!!
          // Tell RabbitMQ: "I finished this. You can delete it from the queue now."
          // If we don't ACK, RabbitMQ thinks we died and will give the job to someone else
          // (or to us again when we restart).
          channel.ack(msg);
        } catch (err) {
          console.error("❌ [Worker] Job Failed:", err);
          // In a real app, you might reject it (nack) or send to a 'dead letter queue'
          channel.nack(msg, false, false); // Reject and discard (for now)
        }
      }
    });

  } catch (error) {
    console.error("Worker failed to start:", error);
  }
}

startWorker();

import express from "express";
import dotenv from "dotenv";
import { connectRabbit } from "../queue/rabbit.js";

dotenv.config();

const app = express();
app.use(express.json());

// ============================================================================
// THE PRODUCER (The Cashier)
// ============================================================================
// This API accepts a request and "Produces" a message into the Queue.
// It DOES NOT do the heavy lifting (posting to Instagram).
// It just says "Okay, I've noted that down to be done."
// ============================================================================

app.post("/post-now", async (req, res) => {
  const { postId, platform } = req.body;

  // 1. Connect to RabbitMQ (Get our virtual "Lane")
  const { channel } = await connectRabbit();

  // 2. Define the Queue Name
  // If this queue doesn't exist, RabbitMQ will create it.
  const queueName = "post_tasks";

  // 3. Assert the Queue
  // 'durable: true' means: If RabbitMQ crashes/restarts, KEEP this queue.
  // Don't lose the line of people waiting!
  await channel.assertQueue(queueName, { durable: true });

  // 4. Create the Message
  // We wrap our data in an object.
  const message = {
    postId,
    platform,
    timestamp: new Date().toISOString()
  };

  // 5. Send to Queue (The Magic)
  // - We must convert JSON to Buffer (computers love binary).
  // - 'persistent: true' means: Save this SPECIFIC message to disk.
  //   If RabbitMQ restarts, this message is saved.
  channel.sendToQueue(
    queueName,
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );

  console.log(`📥 [Producer] Job sent to queue '${queueName}':`, message);

  // 6. Respond to User immediately
  // We don't wait for the post to actually happen. We just say "It's processing".
  // This makes the API super fast.
  res.json({
    status: "queued",
    message: "Your post is being processed in the background!",
    data: message
  });
});

app.listen(process.env.PORT, () => {
  console.log(`🚀 API (Producer) running on port ${process.env.PORT}`);
  console.log(`   Test it: POST http://localhost:${process.env.PORT}/post-now`);
});

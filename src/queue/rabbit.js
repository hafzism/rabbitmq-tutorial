import amqp from "amqplib";

/**
 * CONNECT TO RABBITMQ
 * -------------------
 * This function establishes the "Highway" (Connection) and the "Lane" (Channel).
 *
 * 1. Connection: The TCP connection between your app and the RabbitMQ server.
 *    Think of this as the physical cable or road.
 * 2. Channel: A virtual pathway inside the connection.
 *    RabbitMQ is designed to be efficient. Opening 100 TCP connections is slow/heavy.
 *    Opening 100 Channels inside 1 Connection is fast/light.
 *    We always do work (sending/receiving) via a Channel.
 */
export async function connectRabbit() {
  try {
    console.log("🐰 Connecting to RabbitMQ...");

    // 1. Create the physical connection
    // process.env.RABBITMQ_URL usually looks like 'amqp://localhost'
    const connection = await amqp.connect(process.env.RABBITMQ_URL);

    // 2. Create the virtual channel for this specific task
    const channel = await connection.createChannel();

    console.log("✅ RabbitMQ Connected successfully!");

    return { connection, channel };
  } catch (error) {
    console.error("❌ RabbitMQ Connection Failed:", error.message);
    console.error("   Is the RabbitMQ server running? (Try: sudo systemctl start rabbitmq-server)");
    process.exit(1); // Stop the app if we can't connect, it's critical.
  }
}

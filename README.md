# 🐰 RabbitMQ & Worker Masterclass Tutorial

Welcome! This repository is designed to be the **absolute simplest way** to understand Message Queues (RabbitMQ) and Background Workers.

**This is a learning project.** Every file inside `src/` is heavily commented with "Masterclass" level explanations. Open them to learn exactly how the code works!

---

## 🧠 Core Concepts (The "Why")

Imagine a **Pizza Shop**:

1.  ** The Producer (API)**: This is the Cashier.
    *   **Role**: Takes orders from customers (Users).
    *   **Behavior**: They don't cook the pizza. They just write the order on a ticket and stick it on the **Rail**.
    *   **Benefit**: The cashier is super fast. "Order taken! Next!"

2.  **🐰 RabbitMQ (The Queue)**: This is the Ticket Rail.
    *   **Role**: Holds the orders (messages) safely until a cook is ready.
    *   **Benefit**: Even if the kitchen is busy, new orders don't get lost. They just wait in line.

3.  **👷 The Worker (Consumer)**: This is the Cook.
    *   **Role**: Watches the Rail. Grabs one ticket, cooks the pizza (does the heavy work), and throws the ticket away (Acknowledges it).
    *   **Benefit**: You can have 1 cook or 100 cooks. The Cashier (API) doesn't care. This is how you **scale**.

---

## 📂 Folder Structure

*   **`src/api/server.js`** (The Cashier):
    *   A simple Express server. It accepts `POST /post-now`, connects to RabbitMQ, and sends a "task" to the queue.
*   **`src/worker/worker.js`** (The Cook):
    *   A script that runs forever. It listens to the queue and processes tasks one by one.
*   **`src/queue/rabbit.js`** (The Road):
    *   Shared code to connect to the RabbitMQ server.

---

## 🚀 How to Run (Beginner Guide)

### Prerequisites
You need **Node.js** and **RabbitMQ** installed.

**1. Install RabbitMQ (Linux/Ubuntu)**
```bash
sudo apt-get update
sudo apt-get install -y rabbitmq-server
sudo systemctl start rabbitmq-server
sudo systemctl enable rabbitmq-server
```

**2. Install Dependencies**
```bash
npm install
```

### Running the App
You will need **two terminal windows**.

**Terminal 1: Start the Worker (The Cook)**
This needs to be running *before* or *at the same time* as the API so it can start working immediately.
```bash
npm run worker
# OR
node src/worker/worker.js
```
*You should see: `👷 Worker is running! Waiting for messages...`*

**Terminal 2: Start the API (The Cashier)**
```bash
npm start
# OR
node src/api/server.js
```
*You should see: `🚀 API (Producer) running on port 5000`*

### Testing It
Now act as the Customer! Send an order to the API.

You can use Postman, or just run this `curl` command in a **third terminal**:

```bash
curl -X POST http://localhost:5000/post-now \
     -H "Content-Type: application/json" \
     -d '{"postId": 101, "platform": "Instagram"}'
```

**👀 Watch your terminals!**
1.  **API Terminal**: Will verify it sent the job.
2.  **Worker Terminal**: Will wake up, say "Received job", wait 2 seconds (simulating work), and then say "Job Done!".

---

## 📝 Next Steps
Go open `src/worker/worker.js` and read the comments. Try changing the `setTimeout` to make the worker slower or faster!

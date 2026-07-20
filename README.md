# Simorgh Edge Gateway
[![Ask DeepWiki](https://devin.ai/assets/askdeepwiki.png)](https://deepwiki.com/Shaiinarab/Simorgh-edge-gateway)

Simorgh is an edge-native AI agent gateway built to run entirely on the Cloudflare network. It leverages Cloudflare Workers, native AI models, and Durable Objects with SQLite for high-performance, stateful AI interactions at the edge.

## Features

*   **Edge-Native Execution:** Runs entirely on Cloudflare's global network for low-latency responses.
*   **Integrated AI:** Utilizes Cloudflare's built-in AI binding to access models like Llama 3.2 without external API calls.
*   **Stateful Logging:** Employs Durable Objects with native SQLite to persistently log user interactions for specific tiers.
*   **Intent Shield:** A basic security middleware to block requests that include potentially harmful tool definitions.
*   **Tier-Based Logic:** Implements different logic based on user tiers, such as enabling data logging for `Pro-Data-Pact` users.
*   **Lightweight Framework:** Built with Hono, a fast and lightweight web framework for Cloudflare Workers.

## Architecture

The gateway is composed of several core components of the Cloudflare ecosystem:

*   **Hono Application:** Serves as the main router, handling incoming HTTP requests, applying middleware, and directing traffic to the appropriate handlers.
*   **`DataTrustVault` Durable Object:** A stateful component responsible for managing persistent data. It uses Cloudflare's native SQLite integration to create and manage an `interaction_ledger` table, logging user prompts and metadata. Each user is associated with a unique instance of the Durable Object.
*   **Cloudflare AI Binding:** The `AI` binding, configured in `wrangler.toml`, provides direct, optimized access to Cloudflare's serverless AI models.
*   **Middleware Chain:** A series of functions that process requests before the main logic. This is used to extract context, determine if data logging is required, and perform security checks.

## API Endpoints

### Execute Agent

Executes the AI agent with a given prompt and set of tools.

*   **Endpoint:** `POST /api/v1/agent/execute`
*   **Request Body:**

    ```json
    {
      "prompt": "What is the capital of France?",
      "tools": ["search_web"],
      "userId": "user_123",
      "tier": "Pro-Data-Pact"
    }
    ```
    *   `tier` can be `'Free-Volunteer'`, `'Pro-Paid'`, or `'Pro-Data-Pact'`. Logging is only enabled for `'Pro-Data-Pact'`.

*   **Success Response (200):**

    ```json
    {
      "success": true,
      "meta": {
        "contextRefId": "ctx_c0f6f8b8-...",
        "originalPayloadSizeBytes": 45,
        "payloadHash": "a1b2c3d4...",
        "loggedToLedger": true,
        "ai_model": "llama-3.2-3b-instruct",
        "provider": "Cloudflare Workers AI (Native Free Tier)"
      },
      "agentResponse": "The capital of France is Paris."
    }
    ```

*   **Error Response (403):** Triggered by the Intent Shield for unsafe tools.
    ```json
    {
      "error": "Intent Shield blocked: Unsafe tool invocation."
    }
    ```

### Get User Logs

Retrieves the interaction log for a specific user.

*   **Endpoint:** `GET /api/v1/user/:userId/logs`
*   **Success Response (200):**

    ```json
    {
      "userId": "user_123",
      "totalInteractions": 1,
      "logs": [
        {
          "id": "uuid-...",
          "payload_hash": "a1b2c3d4...",
          "tier": "Pro-Data-Pact",
          "created_at": 1678886400000
        }
      ]
    }
    ```

### Health Check

A simple endpoint to verify the gateway is running.

*   **Endpoint:** `GET /`
*   **Response:** A plain text response: `Simorgh Agentic OS Edge Gateway is soaring.`

## Setup and Deployment

This project is designed to be deployed on Cloudflare Workers.

### Prerequisites

*   A Cloudflare account.
*   [Node.js](https://nodejs.org/) and npm installed.
*   The [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and configured.

### Installation

1.  Clone the repository:
    ```sh
    git clone https://github.com/shaiinarab/simorgh-edge-gateway.git
    cd simorgh-edge-gateway
    ```

2.  Install dependencies:
    ```sh
    npm install
    ```

### Configuration

The primary configuration is in `wrangler.toml`. This file defines the worker's name, entry point, compatibility date, and bindings. The key bindings are:

*   **`[ai]`:** Enables the native Cloudflare AI binding.
*   **`[[durable_objects.bindings]]`:** Configures the `DataTrustVault` Durable Object for persistent storage.

### Local Development

Run the worker locally for development and testing. This will start a server on `http://localhost:8787`.

```sh
wrangler dev
```

### Deployment

Deploy the worker to your Cloudflare account.

```sh
wrangler deploy
```
This command will bundle your code, create the necessary Durable Object migrations, and upload the worker to the Cloudflare network.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createMcpServer } from "./server.js"
import { setTransportAuthHeader, clearTransportAuthHeader } from "./api-client.js"

/**
 * Handle an MCP request using the Streamable HTTP transport (MCP spec 2025-11-25).
 * Stateless, JSON-only (no SSE). Designed for serverless (Vercel).
 *
 * @param authHeader Full Authorization header value (e.g. "Bearer <jwt>" or
 *   "ApiKey <ydi_live_...>"), forwarded verbatim on downstream API calls.
 */
export async function handleMcpStreamable(
  request: Request,
  authHeader: string
): Promise<Response> {
  setTransportAuthHeader(authHeader)
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true, // JSON-only, no SSE
    })
    const server = createMcpServer()
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    await server.close()
    await transport.close()
    return response
  } finally {
    clearTransportAuthHeader()
  }
}

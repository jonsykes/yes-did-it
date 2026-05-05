import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  listTodos,
  setTransportAuthHeader,
  clearTransportAuthHeader,
} from "./api-client.js"

describe("api-client transport auth header", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ todos: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    clearTransportAuthHeader()
    vi.unstubAllGlobals()
  })

  it("forwards an ApiKey Authorization header verbatim (no Bearer rewrap)", async () => {
    setTransportAuthHeader("ApiKey ydi_live_abc123")

    await listTodos({})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("ApiKey ydi_live_abc123")
  })

  it("forwards a Bearer Authorization header verbatim", async () => {
    setTransportAuthHeader("Bearer some.jwt.value")

    await listTodos({})

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer some.jwt.value")
  })
})

import http from 'node:http'

export type RouteContext = {
  url: URL
  path: string
  method: string
  req: http.IncomingMessage
  res: http.ServerResponse
}

export type RouteHandler = (ctx: RouteContext) => Promise<boolean>

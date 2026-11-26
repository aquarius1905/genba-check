#!/usr/bin/env node
// stdio で起動する。stdout は MCP の通信専用なので、ログは stderr にだけ出す（回答は出さない）。
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

await createServer().connect(new StdioServerTransport());
console.error("genba-check MCP server running on stdio");

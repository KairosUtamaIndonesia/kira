export type JsonLineParseResult =
  | {
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly line: string;
      readonly error: string;
    };

export function writeJsonLine(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

export async function* readJsonLines(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<JsonLineParseResult> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of stream) {
    buffer += decodeChunk(decoder, chunk);

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        yield parseJsonLine(line);
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }

  const finalLine = buffer.replace(/\r$/, "");
  if (finalLine.length > 0) {
    yield parseJsonLine(finalLine);
  }
}

function decodeChunk(decoder: TextDecoder, chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return decoder.decode(chunk, { stream: true });
  }

  throw new Error(`Unsupported JSONL stream chunk type: ${typeof chunk}`);
}

function parseJsonLine(line: string): JsonLineParseResult {
  try {
    return {
      ok: true,
      value: JSON.parse(line) as unknown,
    };
  } catch (error) {
    return {
      ok: false,
      line,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

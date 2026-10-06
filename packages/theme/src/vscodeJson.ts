/** Parse a VS Code JSON or JSONC document, including its trailing-comma convention. */
export function parseVSCodeJson(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > 512 * 1024) {
    throw new Error('Theme files must be no larger than 512 KiB.');
  }

  let output = '';
  let inString = false;
  let escaped = false;
  const source = text.replace(/^\uFEFF/u, '');

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    const next = source[index + 1];

    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index++;
      output += source[index] ?? '';
    } else if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n' || source[index] === '\r') output += source[index];
        index++;
      }
      if (index >= source.length) throw new Error('Invalid VS Code JSON.');
      index++;
    } else {
      output += char;
    }
  }

  let withoutTrailingCommas = '';
  inString = false;
  escaped = false;
  for (let index = 0; index < output.length; index++) {
    const char = output[index]!;
    if (inString) {
      withoutTrailingCommas += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      withoutTrailingCommas += char;
    } else if (char === ',') {
      let next = index + 1;
      while (/\s/u.test(output[next] ?? '')) next++;
      if (output[next] !== '}' && output[next] !== ']') withoutTrailingCommas += char;
    } else {
      withoutTrailingCommas += char;
    }
  }

  try {
    return JSON.parse(withoutTrailingCommas);
  } catch {
    throw new Error('Invalid VS Code JSON.');
  }
}

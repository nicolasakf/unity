/**
 * Read a single input line from a TTY in raw mode (echo + backspace + Enter to submit).
 *
 * - Enter: submit the current line (trimmed). An empty line means "done adding paths".
 * - Escape: stop adding paths (`null`). Arrow keys and other CSI sequences are ignored.
 */
export async function readLineWithEscape(
  prompt: string,
  stdin: NodeJS.ReadStream & { setRawMode?: (flag: boolean) => void } = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout
): Promise<string | null> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return "";
  }

  stdout.write(prompt);

  stdin.setRawMode(true);
  stdin.resume();

  let pending = "";
  let line = "";
  let escTimeout: ReturnType<typeof setTimeout> | null = null;

  return await new Promise((resolve, reject) => {
    function cleanup(): void {
      clearEscTimeout();
      stdin.removeListener("data", onData);
      stdin.removeListener("error", onError);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function clearEscTimeout(): void {
      if (escTimeout) {
        clearTimeout(escTimeout);
        escTimeout = null;
      }
    }

    function scheduleLoneEscResolve(): void {
      clearEscTimeout();
      escTimeout = setTimeout(() => {
        escTimeout = null;
        if (pending === "\u001b") {
          pending = "";
          finish(null);
        }
      }, 50);
    }

    function finish(result: string | null): void {
      cleanup();
      stdout.write("\r\n");
      resolve(result);
    }

    function onError(err: unknown): void {
      cleanup();
      reject(err);
    }

    stdin.on("error", onError);

    function redrawAfterBackspace(): void {
      stdout.write("\r\u001b[K");
      stdout.write(prompt + line);
    }

    function onData(chunk: Buffer | string): void {
      clearEscTimeout();
      pending += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;

      while (pending.length > 0) {
        const c0 = pending[0];

        if (c0 === "\r" || c0 === "\n") {
          pending = pending.slice(1);
          finish(line.trim());
          return;
        }

        if (c0 === "\u0003") {
          cleanup();
          process.exitCode = 130;
          process.kill(process.pid, "SIGINT");
          return;
        }

        if (c0 === "\u001b") {
          if (pending.length === 1) {
            scheduleLoneEscResolve();
            break;
          }

          if (pending[1] === "[") {
            const inner = pending.slice(2);
            const terminator = inner.search(/[\x40-\x7e]/);
            if (terminator < 0) break;
            pending = inner.slice(terminator + 1);
            continue;
          }

          if (pending[1] === "O" && pending.length >= 3) {
            pending = pending.slice(3);
            continue;
          }

          if (pending.length >= 2) {
            pending = pending.slice(2);
            continue;
          }

          break;
        }

        if (c0 === "\x7f" || c0 === "\b") {
          pending = pending.slice(1);
          if (line.length > 0) {
            line = line.slice(0, -1);
            redrawAfterBackspace();
          }
          continue;
        }

        const match = pending.match(/^[^\u001b\r\n\x7f\b\x03]+/u);
        if (!match) break;
        const segment = match[0];
        pending = pending.slice(segment.length);
        line += segment;
        stdout.write(segment);
      }
    }

    stdin.on("data", onData);
  });
}

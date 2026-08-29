/** Native messaging owns stdout. Anything else must go to stderr. */
function toStderr(...args: unknown[]) {
  try {
    process.stderr.write(
      args
        .map((a) => {
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" ") + "\n",
    );
  } catch {
    /* ignore */
  }
}

console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.warn = toStderr;

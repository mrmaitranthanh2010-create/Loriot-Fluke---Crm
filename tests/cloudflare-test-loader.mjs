const workersStub = new URL("./cloudflare-workers-stub.mjs", import.meta.url).href;
const emailStub = new URL("./cloudflare-email-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { shortCircuit: true, url: workersStub };
  }

  if (specifier === "cloudflare:email") {
    return { shortCircuit: true, url: emailStub };
  }

  return nextResolve(specifier, context);
}

class JasmineTracker {
  private specDepth = 0;

  specStarted() {
    this.specDepth++;
  }

  specDone() {
    this.specDepth--;
  }

  currentlyInSpec() {
    return !!this.specDepth;
  }
}

const jasmineTracker = new JasmineTracker();
jasmine.getEnv().addReporter(jasmineTracker);

function assertNotInSpec(callerName: string): void {
  if (jasmineTracker.currentlyInSpec()) {
    throw new Error(
        `${callerName} must not be called from beforeEach, it, etc`);
  }
}

/* Returns an object of type State that is cleaned-up for every test case using
 * beforeEach() to avoid leaking state across test cases. */
export function cleanState<State extends Record<string, unknown>>(): State {
  assertNotInSpec('cleanState');
  const state = {} as State;
  beforeEach(() => {
    // If there was no existing state (ie: this was called by `cleanState`),
    // then clear state before every test case.
    for (const prop of Object.getOwnPropertyNames(state)) {
      delete (state as {[k: string]: unknown})[prop];
    }
  });
  return state;
}

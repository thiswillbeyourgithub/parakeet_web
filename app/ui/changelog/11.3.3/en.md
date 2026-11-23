# 11.3.3 (2026-09-12)

## The development banner now expires

An instance running in development mode greets every visitor with a red warning: this instance is being worked on, expect breakage, come back in a few hours. It names how long ago the instance was restarted, which is the part that made the claim checkable.

That claim goes stale. An instance nobody has restarted in five days is not mid-change in any sense a visitor could act on, and a red banner that is simply always there is one nobody reads any more, including on the day it finally matters. So it now takes itself down once the instance has been up longer than five days, and comes back on the next restart.

An instance that does not report when it started keeps its banner. Not knowing when something started is not evidence that it started long ago, and the one setup that reports nothing is the development server itself, where the warning is most warranted.

Written with Claude Code.

## A graphics card that cannot be used is no longer measured for

The short measurement that decides between the processor and the graphics card already skipped machines it could not help. The two small files it measures with, around 5 MB together, were fetched in the background anyway, on every visit, including on machines where no measurement was ever going to run. Those visitors ended up on the processor engine either way, just having paid for it first. They are now fetched only where the measurement can actually happen.

Written with Claude Code.

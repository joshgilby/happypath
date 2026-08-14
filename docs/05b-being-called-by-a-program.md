---
icon: lucide/phone-incoming
---

# Being called by a program

[The previous article](05a-correcting-a-device-without-breaking-it.md) finished with a
working engine: point it at a router, and it reads the device, checks every secret against
a service that owns the plaintext, corrects what is wrong, and confirms by reading back. A
person types a command and waits a couple of minutes for an answer.

That person is about to be replaced by a syslog forwarding rule.

It is worth being precise about what kind of caller that is, because almost every
assumption in the paragraph above is about to stop holding. A forwarding rule does not
wait. It opens no connection it intends to keep, reads no reply, and has no notion of
whether it is asking twice. It will fire when a device reports a change — which is
whenever one happens, including three times in four seconds, including while the engine is
already busy with that very device, including at four in the morning when nobody will read
whatever comes back.

This article is about what the engine looks like from the outside once that is the caller.
It is also the one article in this series where your networking background gives you no
head start: everything in it is software, and most of it is concurrency. The good news is
that you have been operating the central idea for years without calling it that.

It shares [milestone 5's archive](https://github.com/joshgilby/quelaag/releases/tag/milestone-5)
with the previous article.

## An interface that was wrong from its first line

Start with the mistake, because it shaped everything else.

The engine's request interface was originally built the obvious way: a caller asks for a
device to be assured, the connection stays open while the run happens, and the run's report
comes back as the response. That is how you would design it if you pictured a person, or a
script someone runs, on the other end. It is a perfectly ordinary synchronous API and there
is nothing clever about it being wrong.

It was wrong from the first line, because the only thing that would ever call it is a
forwarder that holds no connection and reads no reply. Every property of that design was
addressed to a caller that does not exist. The report went into a response body nobody
would ever read. The caller was held for a device's entire round trip — minutes — which for
a syslog forwarder means its own queue backing up behind ours. And nothing anywhere
considered what should happen if a second request arrived during the first, because a
person does not do that.

Nobody noticed for a whole milestone. The engine worked, its tests passed, and a human
driving it saw exactly what they expected. The mismatch only became visible when the thing
that would actually call it got built.

What happened next is the part worth your attention, because there were two ways to fix it
and the tempting one was available and reasonable. The first was to *amend*: leave
milestone 5 as delivered, change the interface from the next milestone, and carry a section
in the new milestone's documents explaining what had changed and why. That works. It was
built, and it left every article after the change describing an engine that its own article
did not — a series permanently one milestone out of step with its own code.

The second was to put the interface where it always belonged: back in milestone 5, as its
intent rather than as a later correction. That cost a nine-commit rebase, four rewritten
artifacts, and two rounds of cleanup hunting documents that still said "amendment". The
research entry records the reversal rather than hiding it — it says, in as many words, that
the amendment was built and then undone once it was clear where it belonged.

The lesson is not that the second fix was hard. It is that the first one was *available*,
looked reasonable, and would have quietly made every later article describe something the
code did not do. Interface mistakes are cheap while nothing has been built on them and
expensive immediately afterwards, and the expense is rarely the code — it is everything
that has since been written down as true.

One consequence of that rebase is visible here: the scheduler you are about to read arrived
in a single commit, already correct. There is no before-and-after to show you. The bug
further down this article is real and it is documented in the code, but you will not find a
commit where it was fixed.

## Answering at once

Here is what the interface does now:

``` console
$ time curl -s -X POST localhost:8475/assure -d '{"device":"r1"}'
{"device":"r1","accepted":"started"}answered in 0.06s
```

Sixty milliseconds, for an operation that takes minutes. What comes back is not the run's
findings — it is *what became of the request*. The run has not happened yet.

That distinction is the whole design. The reply says `started`, `queued`, `absorbed`, or
`unknown`, and every one of those is a fact about the request rather than about the device.
Fire four more while the first run is still going, as a program would:

``` console
  request 1  -> {"device":"r1","accepted":"queued"}
  request 2  -> {"device":"r1","accepted":"absorbed"}
  request 3  -> {"device":"r1","accepted":"absorbed"}
  request 4  -> {"device":"r1","accepted":"absorbed"}

$ curl … -d '{"device":"r2"}'          # a different device is not held up
  -> {"device":"r2","accepted":"started"}

$ curl … -d '{"device":"not-in-the-inventory"}'
  -> {"device":"not-in-the-inventory","accepted":"unknown"}
```

Five requests for r1 produced two runs. Not five — the engine would spend its life
re-checking a device that had drifted once. Not one — the last request arrived after the
first run had already read the device, so ignoring it could mean missing a change. Two: the
one in progress, and exactly one more owed.

The run happening on the engine's own time raises a question the synchronous design never
had to answer. If nobody is waiting, where does the report go? It goes to the engine's own
output:

``` console
r1 at 2026-08-10T21:41:35+00:00
  admin (privilege 15): correct — none
  operator (privilege 1): correct — none
r2 at 2026-08-10T21:41:35+00:00
  admin (privilege 15): correct — none
  operator (privilege 1): correct — none
r1 at 2026-08-10T21:41:36+00:00
  admin (privilege 15): correct — none
  operator (privilege 1): correct — none
```

Those are rendered by the same code that renders a run for a person at a terminal — one
renderer, two callers. Two renderings of one report would eventually disagree about
something, and a disagreement between what an operator sees and what the log records is the
kind of bug that costs an afternoon during an incident.

## One writer at a time, which you already run

Now the concurrency, starting from something you have operated for years.

Configure a router while a colleague is configuring the same router, and you both read a
configuration the other is changing, and you both commit decisions made from what you read.
The result is a device neither of you intended. Every platform worth using solves this the
same way: exclusive configuration sessions, commit locks, a message telling you somebody
else got there first. One writer at a time against shared state.

The engine needs that for exactly the same reason. Two overlapping runs against one device
would each read its configuration, each ask the verification service about what they read,
and each act — while the other was changing the thing they read. So: **one run per device
at a time**, and any request arriving during a run collapses into **at most one further
run**.

Two rules, and the second is what makes the first tolerable. Without it, a caller that asks
often would build a backlog of runs, each about a device state long since superseded. With
it, asking a hundred times during one run costs exactly one more run, which is what lets a
forwarder be as careless as forwarders are.

The other half is the thread, and it is worth stating as a consequence rather than a
choice. A run is blocking SSH to a device for minutes. Do it inside the request and the
caller waits for the whole round trip — the precise thing this design exists to prevent.
Hand it to the event loop and it stalls every other request, because it never yields. So it
goes on a thread. Not because threads are good, but because the other two options are
already ruled out by facts established before anyone chose anything.

## What the lock actually protects

Here is the thing most worth carrying away from this article, and it is one sentence: the
lock does not protect the device, and it does not protect the run.

It protects two small tables:

``` py title="assurance/scheduler.py"
        self.running = set()
        # Device to the kind of run it is owed. A device appears at most once, which is
        # the whole point; the value says whether that owed run may skip the correcting.
        self.pending = {}
        self.lock = threading.Lock()
```

Which devices are being assured, and which are owed one more. That is all. The lock is held
for as long as it takes to check a set and update a dictionary — microseconds — and never
for the SSH work, which is where all the time goes.

Get this backwards and you build something that works and scales terribly: hold the lock
for the duration of the run, and every device in your fleet queues behind whichever one is
slowest, for no reason at all, since runs against different devices never touch the same
state. The transcript above shows r2 starting while r1 is mid-run — that is not an
optimisation, it is what falls out of locking the data rather than the operation.

*Lock the data, not the operation* is the transferable half of this article. It is also
why the request path can promise to answer at once and mean it: everything it does under
the lock is bounded by the size of two dictionaries.

``` py title="assurance/scheduler.py"
    def request(self, device, dry_run=False):
        """Say what became of the request, at once. The run happens on our own time."""
        with self.lock:
            if device in self.running:
                if device in self.pending:
```

## The bug: two holds where there should be one

Now break it, because it broke.

When a run finishes, the worker has two things to do: decide whether another run is owed,
and — if not — let go of the device so a future request can start a fresh one. Here is the
shipped version:

``` py title="assurance/scheduler.py"
                with self.lock:
                    if device not in self.pending:
                        # Deciding we are finished and letting go of the device must
                        # happen under one hold of the lock. Apart, a request arriving
                        # in between would mark a run pending that nobody would ever
                        # perform — a change quietly dropped.
                        self.running.discard(device)
                        return
                    dry_run = self.pending.pop(device)
```

Both steps under one hold. Now imagine them under two — decide under the first, release
under the second — which is an entirely natural thing to write, and reads just as sensibly:

``` py
                with self.lock:
                    finished = device not in self.pending
                    if not finished:
                        dry_run = self.pending.pop(device)
                if finished:
                    with self.lock:
                        self.running.discard(device)
                    return
```

Between those two blocks there is a moment when the run has decided it is finished and the
device is still marked busy. A request landing in that moment sees a device that appears to
be running, does the correct thing for that situation — marks a run pending, answers
`queued` — and is then erased by the second block, which lets go of a device without ever
looking at `pending` again.

The request was accepted. The caller was told `queued`. No error was raised anywhere, no
device was harmed, and the run simply never happens. Somewhere a password stays wrong
because two lines were in the wrong order.

That is the shape worth recognising, more than the specific bug. Nothing here is exotic:
no lock-free algorithm, no memory model, no clever data structure. Two ordinary statements,
each correct, whose separation opens a window. And the remedy is equally unexotic — one
line moves inside the block. The reason concurrency bugs have a reputation is not that they
are hard to fix. It is that they are hard to *see*, they produce no failure at the moment
they occur, and the thing they break is something that did not happen.

## Constructing a race instead of hoping for one

Which raises the question this whole article has been walking towards. How do you test
that?

"A request arrives at the exact instant a run is deciding it has finished" sounds like
something you can only approximate — run it a thousand times, add a `sleep`, hope to get
unlucky. Tests written that way are worse than no test: they pass on your laptop, fail once
a fortnight in CI, and get marked flaky and skipped.

You do not have to hope. The window is a state you can construct, if you can get code to
run at the moment the lock is released:

``` py title="tests/test_scheduler_race.py"
class FiresOnRelease:
    """A lock that runs one callback the instant it is released, once armed.

    Wrapping the lock leaves the production code untouched and puts the request where
    no amount of sleeping could reliably place it.
    """
```

The scheduler takes its lock from an attribute, so a test can substitute one that fires a
request at precisely the moment of release. In the shipped code, by the time that lock is
released the device has already been let go — so the request finds it idle and starts a
fresh run. In the split-lock version, the same request lands while the device still looks
busy, is accepted as pending, and is discarded moments later.

``` py title="tests/test_scheduler_race.py"
    assert runs == ["r1", "r1"], (
        "a request accepted as the run ended was never performed: it was marked pending "
        "by one hold of the lock and discarded by the next"
    )
```

Against the shipped scheduler this passes; against the two-hold version it fails, every
single time, in about five seconds. Not usually. Every time — because there is no race
being run. The test has arranged the exact interleaving it wants to talk about, so the
outcome is as deterministic as any other assertion in the suite.

The rest of the scheduling tests use the same trick from the other direction: rather than
sleeping and hoping a run is still in progress, they supply a run that blocks until the
test releases it. "While a run is in progress" becomes a state the test creates and holds
for as long as it likes.

``` console
$ uv run pytest -v
  the scheduler answers at once while a run is in progress
  any number of requests during one run become exactly one more
  two runs for one device never overlap
  different devices are assured independently
  a request arriving as a run ends is not dropped
  the scheduler forgets a device once it is idle
```

No device, no service, no lab — every one of those is a claim about scheduling, and
scheduling is the thing you can construct entirely in a test. If you take one habit from
this article, take this one: when a test needs a particular interleaving, build a seam that
lets you produce it, rather than a delay that makes it likely.

## What you have now

The engine can be driven by something that does not wait, does not read the answer, and
has no idea whether it is asking twice. It replies in milliseconds with what became of the
request. It never runs twice against one device at once, never lets requests pile into a
backlog, never holds a caller for a device round trip, and puts its findings where they can
be read by someone who was not waiting for them. And the machinery that guarantees all of
that is a set, a dictionary, and a lock held for microseconds at a time.

What it does not have is a caller. Everything above was demonstrated with `curl`, which is
just a person again, being deliberate about timing. The interface exists, it is correct,
and nothing is plugged into it.

[The next article](06a-closing-the-loop.md) plugs something in — and opens with a hole in
the obvious way of doing it that you can drive through by not pressing enter.

---

*The engine exactly as this article describes it:
[quelaag-milestone-5.tar.gz](https://github.com/joshgilby/quelaag/releases/tag/milestone-5).
To watch it being built commit by commit:
[milestone-4...milestone-5](https://github.com/joshgilby/quelaag/compare/milestone-4...milestone-5)
— the commit list is this article's table of contents.*

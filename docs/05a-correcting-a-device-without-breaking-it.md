---
icon: lucide/wrench
---

# Correcting a device without breaking it

Everything in this series so far has been safe, and safe in the strongest sense available:
nothing built in four articles has changed a single line of configuration on a single
router. The lab reads. The library computes. The vault stores. The service answers. If
every one of them had a bug, the worst outcome was a wrong answer on a screen.

That ends here. This article's component logs into a live device with enable-level
credentials and rewrites its configuration, unattended, on the strength of a judgement it
did not make itself.

It is worth sitting with that for a second, because it changes what "correct" means. Up to
now a mistake produced a bad answer. From here a mistake produces a bad *router* — a
locked-out account, a dropped privilege level, a device that stops trusting the thing that
manages it. The engine in this article is about five hundred lines of Python, and most of
the interesting ones exist to make it refuse to act rather than to act.

You will need the lab running for the transcripts below, and the verification service from
[article 4](04-the-verification-service.md) alongside it:

```sh
curl -LO https://github.com/joshgilby/quelaag/releases/download/milestone-5/quelaag-milestone-5.tar.gz
tar -xf quelaag-milestone-5.tar.gz
cd quelaag-milestone-5
```

## One run, end to end

Point it at a device whose secrets already match the vault:

``` console
$ uv run python -m assurance.cli r1
r1 at 2026-08-10T21:10:40+00:00
  admin (privilege 15): correct — none
  operator (privilege 1): correct — none
```

Two columns, and they are different kinds of thing. `correct` is the *finding* — what the
verification service said about that secret. `none` is the *action* — what this engine did
about it. Keeping them apart in the output is not decoration; the whole article is about
the gap between them.

Now introduce some drift the way it actually happens, by hand, at two in the morning:

``` console
$ ssh admin@192.0.2.11  →  username operator … secret DRIFTED-BY-HAND
done
```

And ask again:

``` console
$ uv run python -m assurance.cli r1
r1 at 2026-08-10T21:11:21+00:00
  admin (privilege 15): correct — none
  operator (privilege 1): wrong — corrected
  the device says this change would do:
    +username operator secret 8 $8$Brix7Kx5j2i4br$8AjJ7BbyxphFGgDkeg7vpEs1AmWxQxETt3CetzjmSy6
```

`admin` was left alone. `operator` was found wrong and put right, and the engine printed
the device's own account of what it was about to do rather than its own intention. The
action says `corrected` rather than `changed`, and that word is earned: after committing,
the engine read the secret back off the device and asked the verification service about it
a second time. A change that was applied but did not verify says `failed`, and one that
could not be re-checked says `applied_unconfirmed`. The engine never reports success on
the strength of having sent a command.

Notice what never appeared anywhere in that run: the password. The engine asked the
verification service for a ready-made hash and pushed that. The component with SSH access
to every router you own is not the component that knows your secrets — which is the
boundary [article 3](03-a-vault-for-known-good-secrets.md) drew, now doing visible work.

## Acting on another service's judgement

Article 4 laboured a point about four outcomes and insisted it was not pedantry. Here is
the payoff, and it is the whole safety model of this component.

The engine never decides whether a secret is wrong. It asks, and it maps the answers onto
exactly four findings:

``` py title="assurance/verification.py"
VERDICTS = {"valid": "correct", "invalid": "wrong", "unknown": "unmanaged"}
```

Anything that is not one of those three — a service that did not answer, a reply with no
`verdict` field in it, a hash in a format the engine cannot even identify — becomes
`not_checkable`. And of the four resulting findings, precisely one permits touching a
device:

| Finding | What it means | What the engine does |
|---|---|---|
| correct | the device matches the vault | nothing |
| **wrong** | it does not match | **corrects it** |
| unmanaged | the vault holds no secret for that account | nothing |
| not checkable | no answer, or a format it cannot identify | nothing |

The module that asks states the rule in its own docstring: *not being able to reach the
service is never evidence that a secret is wrong.* Turn the verification service off and
every secret on every device comes back `not_checkable`, and the engine changes nothing at
all. It reports that it could not check, and stops.

That is worth comparing against the instinct it replaces. A monitoring tool that cannot
reach its dependency often assumes the worst and escalates. Do that here and the failure
mode is spectacular: the service goes down, every secret becomes "wrong", and a component
with enable on every router sets about correcting a fleet it cannot verify — using
replacement hashes it also could not fetch. The safe direction for this component is
always *inaction*, because the thing it does when it acts is irreversible in a way that
reading never is.

This is what it means to say the engine's blast radius is defined by somebody else's
answer. Its authority to change your network is exactly the set of secrets another service
explicitly called wrong — not the ones it suspects, not the ones it could not check, and
not the ones it has an opinion about. The vocabulary article 4 built is what makes that
sentence enforceable rather than aspirational.

## Deciding apart from applying

The engine can be asked what it *would* do:

``` console
$ uv run python -m assurance.cli r1 --dry-run
r1 at 2026-08-10T21:10:49+00:00 (dry run)
  admin (privilege 15): correct — none
  operator (privilege 1): wrong — would_correct
  the device says this change would do:
    +username operator secret 8 $8$ajiT0gTSGaMep2$Dq/jfYMBC1h6JVhGE6y5nbcovI0TaetaeZwluc0icyw

$ uv run scripts/list_users.py r1        # still drifted — a dry run changes nothing
r1: username operator, secret 8 $8$Z/N2XKVS0OIBik$6TwylGhFqPi6jBa9i0aBdeUevObSxid8d8XXaaclIfg
```

`would_correct` rather than `corrected`, and the device is provably untouched afterwards.
The interesting part is what makes that promise worth believing:

``` py title="assurance/engine.py"
"""Works out what is wrong with a device's secrets, and puts them right.

Deciding and applying are separate on purpose. A dry run and a normal run both decide,
and both then build the change and ask the device what it would do; only a normal run
commits it. Because there is one place conclusions are reached and one place the change
is built, a dry run cannot tell you one thing and a real run do another.
"""
```

The shape most codebases reach for is a `dry_run` flag checked before each write. It works
on the day it is written, and it rots: every future change to the engine must remember to
respect the flag, and the first one that forgets turns the dry run into a lie. Worse, it
is a quiet lie — the dry run keeps printing plausible output while no longer describing
what the real run does.

Here there is nothing to remember. `decide` reads the device and returns findings and
touches nothing. `propose` builds the one change this run would make. Only the last step
differs between a dry run and a real one, and it is a single call to commit. Both paths
arrive at the same point by the same route, which is why they cannot disagree.

There is a second prize in this arrangement. `decide` is a pure function of what was read
from the device and what the service replied, so the engine's entire judgement — every
finding, every refusal, every action — is testable with no device and no service in the
room. That is most of why the suite runs 43 tests in under a second on a laptop with no
lab attached.

Operators consult a dry run precisely before doing something they cannot undo. It has to
be true at exactly the moment it matters most.

## Asking the device what your change would do

Now the part that will feel familiar from the other side. Before committing anything, the
engine stages its change and asks the device to describe it — and refuses if the answer
describes more than intended:

``` py title="assurance/engine.py"
    # A device that would change anything else — drop a privilege, touch a neighbouring
    # line — is refused here rather than discovered afterwards.
    if not describes_only(account, corrections):
        set_action(corrections, "refused")
        return account
```

Any network engineer has done this by hand: stage the change, `show | compare`, read the
diff, then commit. What is different is that here it is not a habit, it is an interlock. A
human comparing a diff can be tired, or in a hurry, or looking at the wrong device. This
check runs on every single run and its result is binary — the commit happens or it does
not.

The test itself is deliberately unclever:

``` py title="assurance/engine.py"
def describes_only(account, corrections):
    """Does the device's account of a change mention nothing but these secrets?"""
    expected = {f"username {f['username']} secret 8 {f['replacement']}" for f in corrections}
    for line in account.splitlines():
        if line.lstrip("+-").strip() not in expected:
            return False
    return True
```

Every line of the device's diff must be one of the lines we meant to write. Not "no line
looks dangerous" — a blocklist of dangerous-looking things is a promise you cannot keep,
because the interesting failures are the ones nobody thought of. This is the other way
round: anything unrecognised is a refusal.

The property it buys is subtle and worth naming. The engine believes its change replaces
one `username` line and nothing else. That belief could be wrong — a device on a different
software release, a parser that expands a command into several, a platform quirk nobody
here has met. Asking the device converts a belief the engine holds about itself into a
statement the device makes on every run. It is the same instinct as the round trip in
article 2: do not trust that you agree with the equipment, ask the equipment.

## The turn: the dry run that changed the device

A dry run promises to change nothing. This one was changing the device — and not by
correcting anything. By tidying up.

Getting the device's account of a change requires staging a candidate on it. The obvious
courtesy is to put things back afterwards: stage, read the diff, discard. Measured on the
lab, counting the configuration-change events the device recorded:

``` text
stage, look, and stop                    events: 0
stage, look, and discard                 events: 1
      %SYS-5-CONFIG_I: Configured from console by admin on vty0 (192.0.2.1)
```

Staging a candidate and asking about it costs nothing at all. The *tidy-up* is what the
device notices.

The mechanism is worth knowing, because it is invisible from the calling code. Throwing
away a candidate involves file operations, and the device tooling disables the interactive
file prompt around them — `file prompt quiet` — which is itself a configuration command,
in its own configuration session. The matching `no file prompt quiet` is not issued
alongside it; it goes out when the connection closes. So a discard costs one event as it
happens and a second when the engine hangs up, which is why the count above depends on
when you look. The two `copy` commands doing the actual discarding are exec-mode and free.
The cleanup is the expense, not the work.

Now recall what a configuration-change event *is* in this system. From the next milestone,
every one of them triggers an assurance run. So a dry run that discarded would emit
exactly the events that provoke the run it exists to help an operator avoid. Worse, a
*refused* run — the interlock above declining to touch a device — would tidy up, emit
events, and set off another run about the device the engine just refused to touch. On a
loop.

The fix is to stop being tidy. There is no discard anywhere in the engine, and the absence
is documented where someone would otherwise add one back:

``` py title="assurance/devices.py"
    # There is deliberately no discard. Staging costs a device nothing, but discarding
    # a staged change is *itself* a configuration change — the tooling toggles `file
    # prompt quiet` around it — so it emits the very events this system reacts to.
    # A dry run that discarded would set off the assurance run it exists to avoid.
    # Nothing is thrown away, therefore: every run leaves behind the same two files in
    # the same place, holding the change that run built.
```

Every run leaves its candidate sitting on the device, and the next run overwrites it.
Nothing accumulates, because the material is bounded by construction: the same two files,
in the same place, every time.

There is a coda about how this was measured, and it is the more transferable lesson. The
first attempt at that table produced the exact opposite result — one event for the
harmless case, zero for the discard — because the log was read before the device had
finished writing it. That is the dangerous kind of wrong measurement. A reading taken too
early does not look like noise, which you would distrust; it looks like a *finding*, which
you would write down. It took a deliberate settling delay before the numbers held still,
and the reason to tell you is that everything else in this series rests on measurements
that could have gone the same way.

## Idempotence, and why it is the point

Run the engine again, immediately, against the device it just corrected:

``` console
$ uv run python -m assurance.cli r1
r1 at 2026-08-10T21:11:23+00:00
  admin (privilege 15): correct — none
  operator (privilege 1): correct — none
```

Nothing changed and nothing new was said. That property has a name worth adding to your
vocabulary, because everything after this article assumes it: an operation is
**idempotent** when doing it twice leaves the world exactly as doing it once did. Not
"harmless to repeat" as a matter of luck — indistinguishable, by construction.

It is easy to under-rate as a nicety. It is not one. The engine corrects a device, and the
correction is a configuration change, and from the next milestone every configuration
change triggers an assurance run. So the engine's own work provokes the engine. The only
reason that terminates is that the run it provokes finds everything correct and does
nothing, provoking nothing further. A system that fixed drift *and* reported "corrected"
every time it looked would never come to rest — it would chase its own tail across your
fleet for as long as you left it switched on.

That is why the second column of the report matters as much as the first, and why a run
that changes nothing must also *say* nothing new. Convergence is not a feature bolted on
later; it falls out of this property, and article 6a is where it gets watched to see it
actually go quiet.

One related restraint: a run makes one attempt and stops. No retries, no backoff, no
second go at a device that failed. If a correction did not take, the run reports that and
ends — and something will ask again later, at which point the device is read fresh. A
component that retries inside a run is a component holding stale beliefs about a device
while acting on them.

## What you have now

Quelaag can close the loop by hand. A person can point the engine at a device and have its
secrets read, verified against the vault by a service that owns the plaintext, corrected
where they are wrong, and confirmed by reading them back — with the device itself
vetoing any change that would do more than intended, and a dry run that tells the truth
because it cannot structurally do otherwise.

The limitation is the words *a person can*. Everything here runs when somebody types a
command. The system this series set out to build is supposed to notice drift on its own,
at whatever hour it happens, without anyone deciding to look.

That means the engine needs a caller. Not a person — a program, one that will ask whenever
it has reason to, possibly twice in a second, possibly while a run against that very
device is already in flight. [The next article](05b-being-called-by-a-program.md) is about
what the engine looks like from the outside when the thing calling it never waits for an
answer and never reads the one it gets.

---

*The engine exactly as this article describes it:
[quelaag-milestone-5.tar.gz](https://github.com/joshgilby/quelaag/releases/tag/milestone-5).
To watch it being built commit by commit:
[milestone-4...milestone-5](https://github.com/joshgilby/quelaag/compare/milestone-4...milestone-5)
— the commit list is this article's table of contents.*

---
icon: lucide/repeat
---

# Closing the loop

The obvious way to build this has a hole you can drive through by not pressing enter.

Here is the design anyone would reach for. Devices already announce their configuration
changes over syslog — that is what `%SYS-5-CONFIG_I` is for, and every network engineer
has watched it scroll past. So: point the devices at a listener, have the listener tell the
assurance engine which device just changed, and the loop is closed. Somebody edits a
password, the device says so, the engine checks and corrects it.

It works. You can demonstrate it working. And it fails completely against anyone who
changes a secret and simply stays in configuration mode, because `%SYS-5-CONFIG_I` is
emitted when a session *leaves* configuration mode, not when a change is applied. Sit at
the `(config)#` prompt and the device says nothing at all — for a minute, for an hour, for
as long as you care to sit there.

That is not slow detection. It is no detection, and the length of the gap is chosen by the
one party you would least like to give the choice to. This article is about the receiver
that closes the loop, and about the trigger that turned out to be the wrong one.

It shares [milestone 6's archive](https://github.com/joshgilby/quelaag/releases/tag/milestone-6)
with the final article.

## The component nobody had to build

Before the trigger, the component — because it is the smallest thing in the system and the
only one this project did not write.

Everything the receiver must do, a syslog daemon already does: listen on a port, keep the
messages worth keeping, forward them somewhere. Writing that from scratch would be
re-implementing a mature tool for the pleasure of owning it. So the receiver is a stock
`rsyslog` image and one configuration file, and that file is short enough to read in full:

``` text title="receiver/quelaag.conf"
module(load="imudp")
input(type="imudp" port="5514")

module(load="omhttp")

# The engine is told *where the message came from*, never what it claims to be. Syslog
# text is unauthenticated and can name any device it likes; the source address is the one
# part of a datagram there is some reason to believe.
template(name="assure" type="string" string="{\"address\":\"%fromhost-ip%\"}")
```

Two requirements fall out of *what it is* rather than anything it does. It holds no state,
because a forwarding rule has none to hold. And it cannot reach the vault of known-good
secrets even in principle, because there is no code of this project's in it at all. Those
were requirements in the design document long before this milestone; here they are
satisfied structurally, which is a stronger guarantee than any amount of care.

The template line is the one piece of judgement in the file. A syslog message is
unauthenticated text and can claim to be from any device it likes, so the engine is told
the *source address* of the datagram and never the hostname in the message body. That is
not much of a trust anchor, but it is the only part of the packet there is any reason to
believe — and it is why article 6b cares so much about deployment putting the receiver on
the devices' own network, where addresses survive.

The cost of writing nothing is real and worth stating: this component has no unit tests,
because there is no code to test. Its behaviour is verified against the running lab
instead.

## The turn: what a device says, and when

Back to the hole in the trigger.

The fix is to stop listening for "somebody left configuration mode" and start listening for
"the thing I care about actually changed." IOS has exactly that in its configuration change
logger, which emits a marker when a change is *applied*:

``` text title="lab/configs/r1.partial.cfg"
archive
 log config
  logging enable
  notify syslog
```

Measured on a device, with one session changing a password while another watched, the
difference is stark:

| Moment | What the device had said |
|---|---|
| Change applied, still in configuration mode | `CFGLOG_LOGGEDCMD … secret *`, then `!config: USER TABLE MODIFIED` |
| After leaving configuration mode | …and only now `%SYS-5-CONFIG_I` |

The marker arrives while the operator is still sitting at the prompt. So the device is
filtered to send that and nothing else:

``` text title="lab/configs/r1.partial.cfg"
logging discriminator USERTBL msg-body includes USER TABLE MODIFIED
logging host 192.0.2.10 vrf clab-mgmt transport udp port 5514 discriminator USERTBL
```

Here is the whole thing working. One session changes `operator`'s secret and deliberately
stays in configuration mode; the engine's output is beside it. All times are UTC:

``` console
$ ssh admin@192.0.2.11
  entered configuration mode
  changed operator's secret at 21:50:42 — and stayed at (config)#
  still at (config)# at 21:51:42, having typed nothing further
```

``` console
r1 at 2026-08-10T21:50:45+00:00
  admin (privilege 15): correct — none
  operator (privilege 1): wrong — corrected
  the device says this change would do:
    +username operator secret 8 $8$PHcA1tGlmq4Pd9$XdizJkHCcwWW9M.DiHQv4a5oCMGsQPod2sa275rPSYo
r1 at 2026-08-10T21:50:47+00:00
  admin (privilege 15): correct — none
  operator (privilege 1): correct — none
```

Changed at 21:50:42, corrected at 21:50:45, confirmed at 21:50:47 — and the session that
made the change was still sitting at `(config)#` a full minute later, having never
triggered anything under the old design. Nobody asked for any of this. Nobody was watching.

Two things improved that were not the goal, which is the pleasant kind of surprise. The
marker fires once per user-table change, where the old trigger fired `CONFIG_I`, `CONFIG_P`
and `CONFIG_C` for the same edit — so a hand-made change now costs two runs rather than
three. And a device booting its baseline is far quieter than it was.

There is a second reason to filter on the marker, and it matters more than the timing.

!!! warning "`hidekeys` is not a control you can lean on"

    The configuration change logger records the *command* that made the change — which for
    a password is `username … secret <hash>`, hash and all. `hidekeys` is what redacts
    that line, and during this milestone it was set and then found simply absent from the
    running configuration afterwards, with no error and no warning.

    A design that depended on it would be one silent failure away from posting password
    hashes to an unauthenticated listener. Matching the marker does not depend on it,
    which is most of the argument for choosing the marker.

So there are two filters between a hash and the network: the device's discriminator, which
sends only the marker, and the receiver's own rule, which forwards only the marker. Neither
relies on redaction. In the whole of this milestone's capture, no hash has ever reached the
receiver.

``` text title="receiver/quelaag.conf"
if ($msg contains "USER TABLE MODIFIED") then {
```

One implementation detail in that line is worth a sentence, because it cost time. The match
is on `$msg` and not on `$syslogtag`, which is the field you would reach for — in a Cisco
message the tag is the sequence number, so a tag filter matches nothing at all and does so
completely silently.

## Why it does not run forever

Telling you that the system reacts to configuration changes should have produced an
immediate objection. A correction *is* a configuration change. The engine rewrites a
`username` line, the device dutifully reports that its user table was modified, the
receiver forwards it, the engine runs again — why does this not spin until somebody pulls
the plug?

Because the second run finds everything correct and changes nothing, and a run that changes
nothing provokes nothing. The loop is not broken by a special case or a suppression window;
it terminates because the thing that would continue it has stopped happening.

That is [article 5a's idempotence](05a-correcting-a-device-without-breaking-it.md)
collecting its debt. And it is why the transcript above shows exactly two runs for one
hand-made change: the run that corrected, and the run that its own correction provoked.
After that:

``` console
$ docker compose logs assurance --since 5m | grep -c " at 20"
  runs in the last five minutes: 0
```

Silence. The resting state of this system is nothing happening — not a slow poll, not a
heartbeat. It converges and then it is quiet, which is worth demonstrating rather than
asserting, because "eventually consistent" is a phrase that hides a great deal.

The other half of the guarantee is [5b's scheduler](05b-being-called-by-a-program.md): at
most one further run is ever owed per device. So each run can leave at most one successor,
and never a growing queue of them. A device in the worst shape cannot generate the most
churn.

## Redelivery is free

That same property answers a question the design never had to solve.

Syslog forwarding is at-least-once at best. A daemon may retry; a message may arrive twice;
the receiver has no idea whether the engine acted on the last one. In many systems that is
a genuine hazard requiring deduplication, message identifiers, and a store to remember what
has already been seen.

Here it is free. Repeats collapse into the single pending run, so any number of deliveries
produce at most one more run. The receiver is therefore allowed to be careless — and the
configuration says so out loud, choosing the inherited behaviour rather than accepting it
by default:

``` text title="receiver/quelaag.conf"
           # No retry schedule of its own. Redelivery would be harmless — the engine
           # absorbs repeats into the one pending run — but inherited behaviour is worth
           # choosing on purpose.
           action.resumeRetryCount="0")
```

The property chosen to make the system settle is the same property that makes it tolerate a
sloppy source. That is not a coincidence so much as a reward: coalescing is what both
problems wanted.

## It only reacts to what it hears

Now the limitation, stated rather than glossed, because an event-driven design has exactly
one and it is structural.

**A message that is not heard means a drift that is not corrected.** A dropped UDP datagram,
a receiver that is down, a device with no route to it — in every case the device changed,
nobody heard, and the system will sit contentedly at rest with a wrong password on a router.
Nothing about this design detects that. Scheduled sweeps are on the roadmap for precisely
this reason, and they are a different design rather than a fix to this one.

You can watch the limitation happen at boot, which makes it concrete rather than
theoretical. A device applies its baseline configuration and, in doing so, configures its
own logging. If the receiver is already listening, that is heard. If the device finishes
first, it is not. Measured across two days: on one, both devices finished before the
receiver came up, and the system saw nothing; on the next, the receiver was up first and
r2's marker arrived at 21:48:41 while the device was still coming up.

Whether a boot produces a run is therefore a race, not a property — which is exactly the
limitation in miniature. A real configuration change happened, and whether the system knew
depended entirely on whether anything was listening at that instant. It costs nothing here,
because the run finds every secret correct. It would cost something if the change had been
a real one.

## Two things the boot showed

The captures produced two findings nobody designed for, and both are worth keeping.

**The device does not always send only the marker.** The requirement says it does. At boot
it does not, because messages buffer before the logging host exists and flush the moment it
is configured — arriving before the discriminator can filter anything:

``` text
    %AAA-6-USER_PRIVILEGE_UPDATE: username: admin privilege updated with priv-15
    %LINK-3-UPDOWN: Interface Ethernet0/0, changed state to up
    %CRYPTO_ENGINE-5-KEY_ADDITION: A key named r2.lab has been generated or imported by crypto-engine
    %AAA-4-USERNAME_CONFIGURATION: user with username: operator configured
```

The receiver's own filter dropped every one of them. This is the moment that second filter
stopped looking like belt-and-braces and started looking like the reason nothing went
wrong — a defence in depth is only worth having when the first layer fails, and here is the
first layer failing, at every boot, in a way the requirement did not anticipate.

**And the filter matches its own creation.** One line did get forwarded:

``` text
    %PARSER-5-CFGLOG_LOGGEDCMD: User:vty0  logged command:logging discriminator USERTBL msg-body includes USER TABLE MODIFIED
```

Read it slowly. The command that configures the filter contains the string the filter looks
for. So the device reports its own filter being set up, the receiver dutifully forwards it,
and the engine runs an assurance against a device that has changed nothing whatsoever. It is
harmless, it is the entire explanation of that boot run, and it is a perfect small lesson in
what a text filter is: something with no idea what it is reading.

## What you have now

The loop is closed. A secret changed on a device is detected while the person changing it is
still at the prompt, corrected by a component that never sees a plaintext, verified against
a store only one service can open, and confirmed by reading the device back — with no
schedule, no polling, and no operator awake. Then the system goes quiet, and stays quiet,
because a run that changes nothing provokes nothing.

The component that made it possible is a stock image and twelve lines of configuration.
The most valuable thing in this article is not that the receiver was easy; it is that the
first trigger was wrong in a way you could only find by asking what an *adversary* would do
with it, rather than what a well-behaved operator would.

What is left is the part that decides whether any of this is a system or a demonstration.
Right now starting it takes three commands in three technologies, in an order that fails
confusingly when you get it wrong, and two of the three defects waiting in that process were
invisible to the person who built it — because his machine already worked.
[The last article](06b-shipping-it.md) ships it.

---

*The system exactly as this article describes it:
[quelaag-milestone-6.tar.gz](https://github.com/joshgilby/quelaag/releases/tag/milestone-6).
To watch it being built commit by commit:
[milestone-5...milestone-6](https://github.com/joshgilby/quelaag/compare/milestone-5...milestone-6)
— the commit list is this article's table of contents.*

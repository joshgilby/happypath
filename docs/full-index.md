---
icon: lucide/house
hide:
  - navigation
---

# Happy Path Networking

Thoughts and experience on **network automation** and **AI**, with the emphasis on
demonstration over lecture. Everything here is built, run, and measured against real
equipment — including the parts that turned out to be wrong.

Written by **Josh Gilby**.
[:fontawesome-brands-github: joshgilby](https://github.com/joshgilby) ·
[:lucide-mail: jgilby@happypathnetworking.com](mailto:jgilby@happypathnetworking.com)

## The Quelaag series

An engineer changes a local password by hand and makes a typo. From that moment the
organisation's record of its own credentials is wrong, and nothing anywhere will notice
— not monitoring, not the configuration backup, not the operations staff, whose logins
go to TACACS. The gap stays open until the night TACACS is unreachable and the local
credentials are all that is left.

These nine articles build **Quelaag**, a system that closes that gap on its own: it keeps
a record of what each device's secrets should be, notices when a device changes, checks
the configured secrets against the record, and puts the right value back when they
disagree. Each article ends with a working archive you can download and run against real
router software on your laptop.

The interesting part is not the automation. It is that the system is deliberately built
as several small services rather than one program — a microservice architecture applied
to network automation — and that the series says plainly where its own design was wrong.

<div class="grid cards" markdown>

-   :lucide-pencil-ruler:{ .lg .middle } __Designing before building__

    ---

    The design for the whole system, written before a line of code existed — and the
    three places it turned out to be mistaken.

    [:octicons-arrow-right-24: Start here](00-designing-before-building.md)

-   :lucide-flask-conical:{ .lg .middle } __You don't need a rack of routers__

    ---

    Two Cisco routers on your laptop, defined in one file. Plus three ways to reboot one,
    two of which lie to you.

    [:octicons-arrow-right-24: Build the lab](01-you-dont-need-a-rack-of-routers.md)

-   :lucide-hash:{ .lg .middle } __Reading the `$8$`__

    ---

    What a type-8 hash actually is, and the two encoding details no document records —
    the ones that decide whether your output matches a real device.

    [:octicons-arrow-right-24: Read](02-reading-the-8.md)

-   :lucide-vault:{ .lg .middle } __A vault for known-good secrets__

    ---

    An encrypted store for the plaintext half of every verification, and the boundary
    that lets exactly one component open it.

    [:octicons-arrow-right-24: Read](03-a-vault-for-known-good-secrets.md)

-   :lucide-badge-check:{ .lg .middle } __The verification service__

    ---

    One question, four answers, and why *I could not check* must never be mistakable for
    *this password is wrong*.

    [:octicons-arrow-right-24: Read](04-the-verification-service.md)

-   :lucide-wrench:{ .lg .middle } __Correcting a device without breaking it__

    ---

    The first component that writes to a live router, the interlocks that stop it doing
    more than intended, and a dry run that changed the device by tidying up.

    [:octicons-arrow-right-24: Read](05a-correcting-a-device-without-breaking-it.md)

-   :lucide-phone-incoming:{ .lg .middle } __Being called by a program__

    ---

    What the engine looks like when its caller never waits, never reads the reply, and
    may ask three times in four seconds.

    [:octicons-arrow-right-24: Read](05b-being-called-by-a-program.md)

-   :lucide-repeat:{ .lg .middle } __Closing the loop__

    ---

    The syslog trigger every engineer reaches for, and how to defeat it by not pressing
    ++enter++.

    [:octicons-arrow-right-24: Read](06a-closing-the-loop.md)

-   :lucide-rocket:{ .lg .middle } __Shipping it__

    ---

    One command to start the whole system — and three defects that were broken the entire
    time without ever failing on the machine where it was built.

    [:octicons-arrow-right-24: Read](06b-shipping-it.md)

</div>

## What's next

More network automation, and a strand on **AI** — same standard of evidence: built, run,
and measured rather than asserted.

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

</div>

## What's next

More network automation, and a strand on **AI** — same standard of evidence: built, run,
and measured rather than asserted.

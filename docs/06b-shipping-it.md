---
icon: lucide/rocket
---

# Shipping it

The system works. [The last article](06a-closing-the-loop.md) showed it catching a password
change while the person making it was still sitting at the prompt, correcting it, and
confirming the correction — with nobody watching and nothing scheduled.

Starting it took three commands, in three different technologies, in an order that fails
confusingly when you get it wrong. Bring up the lab with containerlab. Start the
verification service with `npm`, having exported a passphrase into its environment first.
Start the assurance engine with `uv`, pointing it at the verification service. Get the
order wrong and the failures do not say what is wrong with them: a service bound before
its network exists, an engine that answers every request "cannot answer" because its
dependency is not up yet.

A system you cannot reliably start is a demonstration, not a system. This article is about
turning it into one command — and about three things that were broken the entire time
without ever failing once on the machine where it was built.

```sh
curl -LO https://github.com/joshgilby/quelaag/releases/download/milestone-6/quelaag-milestone-6.tar.gz
tar -xf quelaag-milestone-6.tar.gz
cd quelaag-milestone-6
cp .env.example .env
./up.sh
```

## One command, and what it starts

``` console
$ docker compose ps
SERVICE        STATUS         PORTS
assurance      Up 5 minutes   127.0.0.1:8475->8475/tcp
receiver       Up 5 minutes   
verification   Up 5 minutes   127.0.0.1:8474->8474/tcp

$ docker ps --format '{{.Names}}' | grep clab
clab-quelaag-r1
clab-quelaag-r2
```

Three services and two devices. Two of the services are images this project builds, and the
third is the stock rsyslog image from the previous article. `./down.sh` reverses the whole
thing.

Two details in that output carry most of this article. The receiver publishes **no ports at
all**. And the two services that do publish are bound to `127.0.0.1`, not to every
interface — which is what keeps every command articles 2 through 5 documented working
unchanged, against a service now running in a container. `curl localhost:8474` still
reaches the verification service; the vault command line still opens the same vault file.
Packaging that broke all of its own documentation would have been a poor advertisement for
packaging.

## Deployment is part of the design

Here is the part that is not a deployment preference.

The receiver identifies a device by **the address its message came from**. It has to: syslog
text is unauthenticated and can claim to be any hostname it likes, so the source address of
the datagram is the only part with any claim to be believed. Everything downstream — which
device gets read, which device gets corrected — rests on that address being real.

Now put the receiver behind a published port, which is how you would deploy any container
by reflex. Measured three ways, with the same receiver configuration each time:

| Deployment | Address the receiver saw |
|---|---|
| bridge networking, published port | **`172.17.0.1`** — the Docker gateway |
| host networking | `192.0.2.11` — correct |
| **on the lab's own network, nothing published** | **`192.0.2.11`** — correct |

Under the obvious deployment, every device in your fleet arrives wearing the same address:
the gateway's. The system would then confidently assure whichever device that address
resolved to, on every report from any device — and nothing in the application code would
look wrong, because nothing in the application code *is* wrong. Address translation ate the
one fact the design depends on, somewhere below the layer any of this project's code can
see.

That is why the services join the devices' own network rather than publishing to it:

``` yaml title="compose.yaml"
    networks:
      quelaag-mgmt:
        # Fixed, because the devices' baseline configuration names it. Nothing is
        # published: the receiver must sit on the devices' own network so their real
        # addresses reach the engine. Behind address translation every device would
        # arrive looking like the gateway.
        ipv4_address: 192.0.2.10
```

Joining the network *removes* the translation rather than working around it. Host
networking also produced the right answer and was the earlier plan; sharing the lab's
network is better because it needs no privileged flag and gives the services name
resolution among themselves — the receiver posts to `assurance` by name, and the engine
reaches `verification` by name.

The address is fixed at `192.0.2.10` because the devices' baseline configuration names it,
which you saw in the previous article. A container will take a Docker-assigned address
happily, but nothing guarantees the same one across restarts, and every device's
configuration would have to be rewritten when it changed.

The general shape, and the reason this section exists: **some of a system's guarantees
cannot be defended by its code.** No amount of care inside the receiver can recover a
device's identity once the network has replaced it. That property lives in the deployment,
which means the deployment is part of the design and not a step that happens afterwards.

## Two orchestrators, and an order that bites

containerlab owns the devices. Compose owns the services. Neither can nest inside the
other, and the boundary between them has an ordering constraint that is silent when broken:
Compose attaches to a network containerlab creates, so the lab must exist first. Tear down
in the same order and containerlab cannot remove a network that still has containers on it.

So there is a wrapper, and what is interesting about it is what it refuses to hide:

``` sh title="up.sh"
# containerlab needs root, as it has since Milestone 1 — this step will ask for it.
echo "==> the lab (containerlab; needs sudo)"
./lab/up.sh
```

Each step prints what it is about to do. A single command that hides the sequence is fine
until it fails, at which point you cannot tell which half broke — and this milestone
produced several failures that were invisible until measured. Hiding the sequence is the
goal; hiding the *fact* of the sequence is how you get a convenience nobody can debug.

The wrapper is also honest about privileges. `up.sh` needs `sudo` for exactly one step —
containerlab, as it has since article 1 — and says so before asking.

## Reproducibility is a version problem

This project has pinned things since article 1: a lockfile for Python, a lockfile-free Node
side that installs nothing at all, an IOL image the reader builds themselves from a
specific ISO. Containers introduce a new kind of dependency, and it took two attempts to
pin them properly.

The first attempt pinned by tag, which is what every example on the internet shows:

``` console
$ docker image inspect rsyslog/rsyslog:2026-04 --format '{{index .RepoDigests 0}}'
  rsyslog/rsyslog@sha256:0c2960a55e1ee518d09385dbf06703a770e13cd064d46177256b7dad6374a2b2
  recorded when the receiver was first proved out:
  rsyslog/rsyslog@sha256:a36ca517…
```

A *dated* tag — `2026-04` — was chosen precisely because a date looks immutable. It is not.
It is a name, and a name can be repointed. Whether it was repointed or the original note
was wrong can no longer be determined, and that ambiguity is the argument by itself: a
reference that can move is not a record of what you ran.

The other tag was worse in a quieter way. `python:3.12-slim` names no patch version at all
— it followed 3.12.13 the day it was written and would have followed 3.12.14 without
asking. So every image reference now carries a digest, in the Dockerfiles as well as the
compose file:

``` console
$ grep -rnE '^ *(image:|FROM |COPY --from=)' compose.yaml */Dockerfile
  compose.yaml      image: rsyslog/rsyslog:2026-04@sha256:0c2960a55e1ee518d09385dbf06703a770e13cd064d46177256b7dad6374a2b2
  assurance/Dockerfile  FROM python:3.12.13-slim@sha256:646fb0bca3dd3ea1bcc6feb72c17ed16eed6e10cffc732fcc1478bd3e7f02d7b
  assurance/Dockerfile  COPY --from=ghcr.io/astral-sh/uv:0.5.11@sha256:0ac957607303916420297a4c9c213bb33fbd3c888f9cd7f4f7273596ebf42b85 /uv /usr/local/bin/uv
  verification/Dockerfile  FROM node:22.11.0-alpine@sha256:b64ced2e7cd0a4816699fe308ce6e8a08ccba463c757c00c14cd372e3d2c763e
```

Tag *and* digest together: the tag says which version this is to a person reading, and the
digest is what actually decides.

There is a lesson hidden in that command, too. The check that was supposed to catch
unpinned images grepped `compose.yaml` for `image:` — which cannot see a `FROM` line in a
Dockerfile, and so reported success while two of the four references were unpinned. A check
that cannot see the thing it is checking is worse than no check, because it is also a
reason to stop looking.

## Three things a working machine hid

Now the turn, and it is three of them. Each was broken from the first day of this milestone.
None of them ever failed for the person who built it.

**The tag that moved** is the first, and you have just read it. It could not be noticed on a
machine that already had the image pulled — the local copy is whatever was fetched the first
time, and it keeps working perfectly while the reference beneath it drifts.

**The vault directory that arrived owned by root** is the second. The verification service
reads the vault from a bind mount, and the mount source is a path on the reader's machine.
On a machine where that path already exists, everything works forever. On a clean checkout
it does not exist — and Docker, rather than failing, creates it:

``` console
$ docker run --rm -v $PWD/does-not-exist:/vault alpine:3.21 stat -c '%F %U' /vault
  directory, owned by root
$ ls -ld $PWD/does-not-exist                    # on the host, afterwards
  drwxr-xr-x root root
```

That is a directory where a vault should be, owned by root, on the one command that
promised to need no privileges. Worth being precise about why it is hard to undo: an empty
root-owned directory can actually be removed, because deleting a thing depends on
permission over its *parent*, which you own. It becomes genuinely stuck the moment the
service — running as root inside its container — writes into it, and now the reader owns
neither the directory nor the file inside it. The fix is one line in `up.sh`, which makes
the directory as the reader before Compose can make it as root.

**The two vaults** are the third, and the worst.

``` console
$ node verification/src/vault-cli.js get r1 admin      # the documented command
  CHANGE-ME-ADMIN
$ docker compose exec verification printenv QUELAAG_VAULT_PATH
  /vault/vault.json
$ docker compose config --format json | grep -o '[^"]*\.quelaag[^"]*'
  /home/jgilby/.quelaag
```

They agree now. The first version mounted a vault file at the repository root instead of the
directory the vault command line already defaults to. So there were two vaults: the reader
followed article 3's documented `put` commands and filled one, and the verification service
faithfully read the other. A secret plainly recorded came back as `no secret recorded`.

Sit with how that fails. Nothing errors. The vault command line works. The service starts,
opens its vault successfully, and answers every question correctly according to the file it
was given — which is empty. The engine receives `unknown` for every account, and `unknown`
means *make no claim*, so it correctly changes nothing. Every component behaves exactly as
designed and the system as a whole does nothing at all, for a reason no error message
anywhere would name.

And it never broke for the author, because his vault predated the packaging and sat exactly
where the old command line put it. That is the thread joining all three: none is a
sophisticated bug, and all three are invisible from a machine that already works. They are
found by asking what a *clean checkout* does — a question the quickstart asks on the
reader's behalf and this design had not asked of itself.

## What you have, and what this series was

The system starts with one command and stops with one, on a machine that has never run it
before. Three services and two devices, every image pinned by digest, no secret in any
committed file, the receiver holding an address on the devices' own network so that a
device's identity survives the trip.

Which finishes the thing this series set out to build. Somebody changes a password on a
router at two in the morning; the device says so while they are still at the prompt; the
engine reads it, asks a service that owns the plaintext, and puts it back — never having
seen the secret itself. Then everything goes quiet.

Nine articles, and the same habit runs through all of them. Nearly every claim in this
series was checked against a real device, and a surprising number did not survive the
check. The hash that looked plausible and matched nothing. The reboot that was not a reboot.
The dry run that changed the device by tidying up. The vault that reported a locked file as
an empty one. The trigger you could defeat by not pressing enter. The scheduler test that
covered a race it did not actually reach. None of those were found by careful thought; every
one was found by running something and reading what came back, and most of them contradicted
a document that was otherwise correct.

That is the argument the whole series exists to make, and it is why the decision log kept
its wrong entries next to the right ones. A design that admits where it was wrong is not
weaker than one that does not. It is the only kind you can trust the rest of.

The pieces are all small. A library that does one thing. A vault that stores and returns.
A service with four possible answers and a rule about never emitting a fifth. An engine
whose authority is bounded by somebody else's verdict. A receiver that is twelve lines of
configuration. None of them is clever, and the system they make is one you can reason about
at two in the morning — which is the only time it matters.

---

*The whole system, exactly as this article describes it:
[quelaag-milestone-6.tar.gz](https://github.com/joshgilby/quelaag/releases/tag/milestone-6).
To watch it being built commit by commit:
[milestone-5...milestone-6](https://github.com/joshgilby/quelaag/compare/milestone-5...milestone-6)
— the commit list is this article's table of contents.*

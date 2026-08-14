---
icon: lucide/badge-check
---

# The verification service

Three articles have quietly built a working system that nobody can use. There is a lab
full of routers, a library that reads the hashes they store, and a vault holding what
those hashes are supposed to be. Every piece works, and every piece works *here* — on one
machine, driven by a person at a terminal who knows the passphrase.

The thing that actually needs to ask "is this password still right?" is a program, running
somewhere else, at whatever hour a router's configuration changes. Which means the last
two pieces have to be joined across a network, and that is not a plumbing exercise. A
function call either returns or throws, and you wrote both ends. A network call can
succeed, fail, hang, half-answer, or answer confidently with something untrue — and the
component asking has no way to tell which happened except by what comes back.

This article builds the join: a service that answers one question. Most of it is about
what the answers are allowed to be, because getting that wrong is how a system that fixes
passwords becomes a system that overwrites them. It is the other article you can run
without a router:

```sh
curl -LO https://github.com/joshgilby/quelaag/releases/download/milestone-4/quelaag-milestone-4.tar.gz
tar -xf quelaag-milestone-4.tar.gz
cd quelaag-milestone-4
```

## One question, four answers

Start it, pointing at a vault holding the lab's documented fakes:

``` console
$ QUELAAG_VAULT_KEY='the-right-passphrase' npm start --prefix verification
verification service listening on localhost:8474
```

It takes a hash and answers whether that hash is the right one for a given account. Four
things can come back, and the difference between them is this article:

``` text
the hash the vault expects         200  {"verdict":"valid"}
a hash of something else           200  {"verdict":"invalid"}
a user the vault never had         200  {"verdict":"unknown"}
a format it cannot evaluate        503  {"error":"unsupported secret format: type5"}
```

The first two are unsurprising. The third and fourth are the ones worth the rest of this
section, because both are ways of saying *I am not going to answer that*, and they mean
completely different things.

**`unknown` means the question was fine and quelaag has no opinion.** The vault holds no
entry for that account, so nothing is known about what its password should be. Crucially
this is a *successful* reply — status 200, a real verdict — because "I do not manage this
account" is a perfectly good answer to a well-formed question. Routers are full of
accounts that some other team owns; a system that reported them as *wrong* would be
inventing work at best and doing damage at worst.

**The fourth is not an answer at all.** Something went wrong inside — the vault would not
open, the format is one the library cannot evaluate — and the service does not know
whether the hash is right. Look at the shape of that reply: it carries `error`, and it
carries **no `verdict` field whatsoever**. That is deliberate to the point of being the
main design decision in this milestone. A caller doing the obvious thing —

``` js
if (body.verdict === "invalid") { correctTheDevice(); }
```

— reads `undefined` and does nothing. There is no value it could read that would mislead
it, because the field is not there. Compare the alternative that a hurried design reaches
for, a `valid: true/false` boolean: now "could not check" has to be squeezed in as `false`
or `null`, and `false` means *this password is wrong, go change it*. The distinction that
looks like pedantry on a whiteboard is the distinction between a system that corrects a
secret and one that overwrites a secret it could not check.

Here is that rule in the code, which is shorter than the explanation:

``` js title="verification/src/service.js"
    } catch (error) {
      // A locked vault, an unknown format, anything at all: if we could not work out
      // the answer, we say so rather than guessing. The reply carries no verdict
      // field, so a caller reading one finds nothing rather than something wrong.
      reply(response, 503, { error: error.message });
      return;
    }
```

And the rule it enforces, which the next article's engine is built on: **change a device
only on `invalid`.** Not on `unknown`, not on silence, not on an error. Nothing but an
explicit statement that the password is wrong authorises touching a router.

## The milestone where `unknown` was a lie

That rule has a hole in it that took building the service to find, and it is the best
thing in this milestone.

[Article 3](03-a-vault-for-known-good-secrets.md) left the vault handling exactly one
failure: a wrong key. Give it a bad passphrase and it says so, distinctly, rather than
pretending to be empty. What it did *not* handle was every other reason a vault file might
not open. Its file-reading code caught everything and treated it identically to a vault
that does not exist yet:

``` js
  } catch {
    // No vault yet: an absent vault behaves like an empty one.
    return null;
  }
```

Absent means empty, which is correct and friendly — asking an empty vault about an account
should say `unknown`, not raise an error. But a vault that exists and cannot be read is
not empty. It is *unavailable*, and answering "nothing recorded" about it is a lie that
looks exactly like the truth.

For all of article 3 this was harmless, which is precisely why it survived. A person at a
terminal who runs `get` against a vault they cannot read sees "no secret recorded",
frowns, notices the permissions, and moves on. Nothing acts on the answer. The service is
the first thing in this series that *is* something acting on the answer.

You can watch it happen, because both archives are downloadable. Drop article 3's
`vault.js` into this article's tree, make the vault unreadable, and ask:

``` console
$ GOOD=$(printf 'CHANGE-ME-ADMIN' | node verification/src/cli.js)   # article 2's generator

# stop the service, put article 3's vault in place, and start it again — a running
# process holds the module it already loaded, so the swap has to happen first
$ cp verification/src/vault.js /tmp/vault-m4.js      # keep this article's version
$ cp ../quelaag-milestone-3/verification/src/vault.js verification/src/vault.js
$ QUELAAG_VAULT_KEY='the-right-passphrase' npm start --prefix verification &

$ chmod 000 "$QUELAAG_VAULT_PATH"
$ curl -s -w ' %{http_code}\n' -X POST localhost:8474/verify -H 'content-type: application/json' \
    -d '{"service":"r1","username":"admin","format":"type8","hash":"'"$GOOD"'"}'
{"verdict":"unknown"} 200
```

Status 200. A verdict. The vault is sitting right there holding the correct secret, and
the service has just told its caller, in the system's own official vocabulary, that this
account is not one quelaag manages. Every safety property in the previous section is
intact and every rule is being followed — and the answer is false. A misconfigured
permission has become an authoritative statement about a router.

The fix is small, and its comment is the lesson:

``` js title="verification/src/vault.js"
  } catch (error) {
    // A vault that isn't there yet behaves like an empty one. A vault that is there
    // but cannot be read is a different situation entirely, and saying "no secrets
    // recorded" about it would hide a real problem.
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
```

Only a missing file means empty. Everything else propagates, becomes the cannot-answer
outcome, and reaches the caller as a 503 with no verdict in it:

``` console
# restore this article's vault, restart the service, and ask the identical question
$ cp /tmp/vault-m4.js verification/src/vault.js
$ QUELAAG_VAULT_KEY='the-right-passphrase' npm start --prefix verification &

$ curl -s -w ' %{http_code}\n' -X POST localhost:8474/verify -H 'content-type: application/json' \
    -d '{"service":"r1","username":"admin","format":"type8","hash":"'"$GOOD"'"}'
{"error":"EACCES: permission denied, open '…/vault.json'"} 503
```

Two things are worth taking from this beyond the bug. The first is where it was found:
not by review, not by a test written against the vault, but by composing the vault with
something that had opinions about what its answers meant. A component is only as correct
as the questions anyone has thought to ask it, and article 3 never had a caller that
distinguished "no" from "I don't know" — so the vault was never asked to either.

The second is that a catch-all `catch` is a decision, not a formality. It said *every way
this can fail means the same thing*, which was true when it was written and stopped being
true the moment something downstream cared. That is a general shape worth recognising:
error handling that collapses distinctions is fine right up until someone builds on the
distinction you collapsed.

## Earning the boundary

Article 2 argued the hashing library should stay a library — no state, no I/O, no
lifecycle, so a service would buy a network hop and cost a failure mode. All of that is
still true. So what changed?

Not the hashing. What changed is that something *else* now needs to ask, from another
process, and there is a thing that must not travel: the plaintext.

Work through the alternative and the boundary argues for itself. The assurance engine —
next article — logs into routers and corrects wrong passwords. Give it the library and the
vault as ordinary imports and it verifies locally, no network involved. It also becomes a
component that reads plaintext secrets, on a host that speaks SSH to every router you own,
whose whole job is running risky operations against production equipment. Every secret in
the vault is now one bug, one log line, one crash dump away from somewhere it should never
be.

So the network hop is not a cost this design reluctantly accepts. It *is* the design. Put
a process boundary between the thing that holds plaintext and the thing that touches
routers, and the property becomes structural: the engine cannot leak a secret it has no
way to obtain. What crosses the boundary is a verdict, and — when a device does turn out
wrong — a freshly generated hash. Never the secret itself.

That is what "earning" a service boundary means, and it is a much better test than
counting requests per second. This library did not become a service because it grew. It
became a service because a boundary appeared that was worth paying a network for, and the
service is where that boundary is enforced. Two articles ago the honest answer was *no
service*; the reason has changed, so the answer has.

## No framework

A detail that says something about the whole project. Here is the service's manifest, in
full:

``` json title="verification/package.json"
{
  "name": "quelaag-verification",
  "version": "0.1.0",
  "description": "Generates and verifies the secret hashes network devices store",
  "type": "module",
  "scripts": {
    "test": "node --test",
    "start": "node src/serve.js"
  }
}
```

There is no `dependencies` key at all. An HTTP service, its tests, AES-256-GCM encryption
and PBKDF2 hashing, and the install step is nothing.

This is a reversal, recorded as one. The project's original design named Express as the
service basis — a reasonable choice that most readers would reach for by reflex. When the
time came to write the thing, the requirement turned out to be one route pair and one JSON
body parse, which Node's built-in `http` handles in a few lines. Express would have bought
familiarity rather than capability, and it would have cost the property this project has
held since article 1: that a reader installs nothing but the runtime.

The decision log carries both entries, the original and the one superseding it, because
entries there are never edited. That is the point of keeping one — a design document that
quietly rewrites itself to match what got built teaches nothing, while one that shows a
choice being reversed for a stated reason teaches exactly the thing that is hard to learn
from finished code.

Being honest about the cost: the twenty lines of routing and body-parsing in
`service.js` are lines a framework would have hidden, and readers hunting for a familiar
`app.post(...)` will not find one. That is a real trade. It is also, for a series about
composing small services, the more useful direction — nothing here is hidden, so nothing
here is magic.

## Failing at startup instead of answering wrongly

The vault key reaches the service the same way it reached the command line: an environment
variable, never an argument. But a service is not a command line — it starts once and runs
for months, and nobody is watching when it starts.

So it opens the vault immediately, before it listens for anything:

``` js title="verification/src/serve.js"
try {
  listEntries(passphrase);
} catch (error) {
  console.error(`cannot start: ${error.message}`);
  process.exit(1);
}
```

``` console
$ QUELAAG_VAULT_KEY=wrong npm start --prefix verification
cannot start: that key does not open this vault
$ echo $?
1
```

Skip that check and nothing appears to be wrong. The service starts, binds its port, and
looks healthy to anything that pings it — while answering *cannot answer* to every request
it will ever receive. Because the previous sections got the vocabulary right, nothing acts
on those replies, so no router is harmed. Instead the whole system simply stops verifying
anything, silently, and the first person to notice does so hours later when they wonder
why nothing has been checked since Tuesday.

The general shape: a component that cannot do its job should refuse to start, loudly,
where a human is watching — rather than start successfully and fail one request at a time
where nobody is. A non-zero exit is not a courtesy here, it is the entire signal that
anything is wrong.

Note what this does *not* do. Once running, a vault problem is no longer fatal: it becomes
the per-request cannot-answer outcome. Startup is where you can still refuse; afterwards
the honest move is to keep serving and be clear about what you cannot answer.

## Testing an HTTP service without a test dependency

The suite grew to 29 tests across the library, the vault and now the service, and still
installs nothing:

``` console
$ npm test --prefix verification
# tests 29
# pass 29
# fail 0
```

Testing HTTP conventionally means adding a library for it. Here the tests import the
request handler, start a real server on port 0 — the operating system hands out a free
port, so tests never collide with each other or with a service you left running — and
drive it with Node's built-in HTTP client. Each gets its own temporary vault, as the
vault's own tests do, so no test can read or damage a real one.

That is worth more than the saved dependency. Because the tests speak real HTTP, they
cover the status codes and body shapes that this article's central rule depends on — a
test can assert that a locked vault produces 503 *and* that the body has no `verdict`
field. Call the handler functions directly and both of those go untested, which is half
the safety property gone. Two of the 29 exist because of the bug earlier in this article:
one asserts an unreadable vault is not mistaken for an empty one, and one asserts the
service refuses to answer about it.

## What you have now

Quelaag can now answer its central question over a network, and — more importantly — has a
vocabulary careful enough that a caller cannot misread the answer. Valid, invalid, and
unknown are verdicts. Anything the service could not work out is not a verdict, does not
look like one, and cannot be mistaken for one by code doing the obvious thing. The
plaintext never leaves the process that owns it; what crosses the wire is a judgement, or
a hash the caller can apply without ever learning what it encodes.

The system still does nothing on its own. Everything so far has been safe in the strong
sense: nothing in this repository has changed a single line of configuration on a single
router. Every article has read, computed, stored, and answered.

That ends next. [The next article](05a-correcting-a-device-without-breaking-it.md) builds
the component that logs into a live device and rewrites its configuration — acting on this
service's verdicts, and on nothing else. Everything careful about the four answers was
groundwork for something that can now do real damage if it misreads one.

---

*The service exactly as this article describes it:
[quelaag-milestone-4.tar.gz](https://github.com/joshgilby/quelaag/releases/tag/milestone-4).
To watch it being built commit by commit:
[milestone-3...milestone-4](https://github.com/joshgilby/quelaag/compare/milestone-3...milestone-4)
— the commit list is this article's table of contents.*

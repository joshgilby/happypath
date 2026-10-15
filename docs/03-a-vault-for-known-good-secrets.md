---
icon: lucide/vault
---

# A vault for known-good secrets

[The last article](02-reading-the-8.md) built something that answers one question: does
this plaintext produce this hash? It takes two inputs. One of them a router hands you on
demand — `show running-config`, and there is the `$8$` string. The other one is the
password itself, the thing that is supposed to be true, and this series has been quietly
pretending it comes from nowhere.

Every verification the rest of this system performs needs that second input. Which means
that before Quelaag can check anything continuously, something has to hold the plaintext —
not in a password manager a person unlocks, not in a spreadsheet, not in somebody's head,
but somewhere a program can read at three in the morning without being asked twice. That
is a genuinely uncomfortable requirement, and pretending otherwise would be the wrong way
to start. A system that verifies secrets is a system that keeps secrets.

This article builds that store: an encrypted file on local disk, one entry per service and
username, driven by three commands. More importantly, it draws the line around it — who
may open it, what happens when they cannot, and why exactly one component in this entire
system is ever allowed to look inside.

It is also the first article in this series you can run without a router. The vault touches
no device and speaks no network, so if the licensed image in
[before you start](before-you-start.md) is out of reach for you, this is where that stops
mattering — this article runs in full, and so does the next one. Everything below runs from
the archive:

```sh
curl -LO https://github.com/joshgilby/quelaag/releases/download/milestone-3/quelaag-milestone-3.tar.gz
tar -xf quelaag-milestone-3.tar.gz
cd quelaag-milestone-3
```

## Three verbs

The vault does three things, and the command line is the shape of them:

``` console
$ export QUELAAG_VAULT_KEY='the-right-passphrase'
$ export QUELAAG_VAULT_PATH="$PWD/demo/vault.json"

$ printf 'CHANGE-ME-ADMIN' | node verification/src/vault-cli.js put r1 admin
$ printf 'CHANGE-ME-OPERATOR' | node verification/src/vault-cli.js put r1 operator

$ node verification/src/vault-cli.js list
r1 admin
r1 operator

$ node verification/src/vault-cli.js get r1 admin
CHANGE-ME-ADMIN
```

Those are the lab's documented fakes from article 1, so nothing here is a real secret.
`QUELAAG_VAULT_PATH` is an override; left unset, the vault lives at `~/.quelaag/vault.json`,
and the tests use the override so the suite can never touch an operator's real one.

An entry is identified by the pair — service and username — and recording the same pair
again replaces what was there. The vault holds what a secret *is*, not what it has been;
there is no history to leak and no previous value to recover. Matching is exact, so `R1`
and `r1` are different entries. That sounds pedantic until you picture the alternative: an
operator who meant to replace a secret quietly creating a second one, leaving the system
verifying against a value nobody updated.

Now look at how the secret and the passphrase got in there, because both are deliberate.
The passphrase arrives in an environment variable and the secret on standard input, and
**neither is ever a command-line argument**. Article 2 introduced that rule for the hashing
CLI; here is the concrete reason, which is specific to Linux and worth knowing precisely:
`/proc/<pid>/cmdline` is world-readable, so an argument is visible to every user on the
host for as long as the process runs, and to anyone running `ps` at the right moment. The
process environment, `/proc/<pid>/environ`, is readable only by the account that owns it.
Same machine, same process, two very different exposures — decided entirely by which
channel you reach for.

## What is actually on disk

Encryption at rest gets described more often than it gets looked at, so look at it:

``` console
$ ls -l $QUELAAG_VAULT_PATH
-rw------- 1 jgilby jgilby 190 Aug 10 16:03 …/vault.json

$ cat $QUELAAG_VAULT_PATH
{"salt":"jRGfszRocI9q4NJSGOcdPA==","iv":"M/5KYcHz8NrQ4OWd","tag":"QsPUZy1gD9W4K25D85N8Hw==","data":"BOfUgDR2u8Cznz9eHEGPDt7XT1fEiCpiLv/dKKU7VW2wodXGto4t4rpYy7mHUM3hyhZewkWFMWPHJgKbbtKS8DgP"}
```

Two things to notice before the fields. The permissions are `-rw-------`: owner only, set
when the file is created rather than left to whatever the system's default happens to be.
And `data` is one blob. The whole vault — every secret, and every service name and username
too — is encrypted together, which is why the file does not disclose that `r1` exists or
that it has an account called `admin`. Encrypting each entry on its own would have left the
names in the clear and the entry count countable, and a list of which devices and accounts
a system tracks is worth having even without the passwords attached.

The other three fields are not secrets, and it is worth being clear about why they can sit
there in the open:

| Field | What it is | Why it is safe in the clear |
|---|---|---|
| `salt` | 16 random bytes, fixed when the vault was created | needed to re-derive the key from your passphrase |
| `iv` | 12 random bytes, **fresh on every write** | needed to decrypt; reusing one would be the real danger |
| `tag` | the cipher's authentication tag | proves the file has not been altered |

Run `cat` again after any `put` and the whole line will have changed, including `iv` and
`tag`. That is not the vault being nondeterministic for its own amusement — a fresh
initialisation vector per write is a requirement of the cipher, and reusing one across two
encryptions with the same key is one of the classic ways to destroy a scheme that is
otherwise sound.

The cipher is AES-256-GCM, from Node's built-in `crypto` — still no dependencies, three
articles in. GCM's authentication tag is what makes the file tamper-evident, and it earns
its keep again in a moment.

## A passphrase is not a key

This step is easy to skip but greatly improves key strength:

``` js title="verification/src/vault.js"
  const salt = envelope ? Buffer.from(envelope.salt, "base64") : randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(12);
```

AES-256 wants exactly 32 bytes of key. What an operator types is a passphrase — the wrong
length, and drawn from a much smaller space than 32 random bytes, because humans choose
it. Handing that string to the cipher directly, padded or truncated to fit, is lesas secure.

`scryptSync` stretches the passphrase into a proper key, and it is deliberately expensive
to run — around forty milliseconds on the author's laptop, and memory-hungry by design. That is
some fifteen times the cost of verifying a single hash in [article 2](02-reading-the-8.md),
for a job done once per command rather than once per secret. At a terminal you will
not notice. To someone working through a dictionary against a stolen vault file, that cost
is charged per guess, which is the entire point: it converts a cheap offline attack into an
expensive one.

The salt in front of it does a job you have met before. Article 2's hashes carried a
per-password salt so that one precomputed table could not attack every password at once;
this is the same defence at the file level. Every quelaag vault ever created has its own
random salt, so an attacker cannot build one table of stretched passphrases and try it
against all of them. And, exactly as with the type-8 hashes, the salt must be stored in the
clear or the same passphrase could never re-derive the same key.

## A write that cannot destroy the vault

The vault is the system's source of truth. If a write is interrupted halfway, a truncated
file does not lose one secret — it loses all of them, and nothing else in the system holds
a copy. So a recording is never written in place:

``` js title="verification/src/vault.js"
  // Write beside the vault and rename over it: a rename is atomic, so an
  // interrupted write leaves the previous vault whole rather than truncated.
  const pending = `${path}.pending`;
```

Write the new vault to a neighbouring file, then rename it over the old one. A rename
within a directory is atomic on Linux, so at every instant the vault file is either
entirely the old version or entirely the new one. There is no window in which it is half of
each.

That property is testable without staging a crash — make the write itself fail:

``` console
$ chmod 500 "$(dirname $QUELAAG_VAULT_PATH)"          # make the directory unwritable
$ printf 'A-NEW-SECRET' | node verification/src/vault-cli.js put r1 operator
EACCES: permission denied, open '…/vault.json.pending'

$ chmod 700 "$(dirname $QUELAAG_VAULT_PATH)"
$ node verification/src/vault-cli.js get r1 admin
CHANGE-ME-ADMIN

$ node verification/src/vault-cli.js list
r1 admin
```

The failed recording took nothing with it: `admin` is intact and `operator` was never
half-added. Note where the error names the casualty — `vault.json.pending`, the temporary
file. The real vault was never opened for writing at all.

This is two lines of code, not a recovery subsystem, and that distinction matters to a
project that otherwise refuses to handle failures it has not been asked to handle. Nothing
here detects damage or repairs anything. It simply arranges that the damaging case cannot
occur.

## The one failure it does handle

This milestone is happy-path work with exactly one deliberate exception, and it is this
one:

``` console
$ QUELAAG_VAULT_KEY='the-right-passphrase' node verification/src/vault-cli.js get r1 admin
CHANGE-ME-ADMIN

$ QUELAAG_VAULT_KEY='not-the-passphrase' node verification/src/vault-cli.js get r1 admin
that key does not open this vault
```

A wrong key must never look like an empty vault. Not "should not" — must not, and the
reason is two milestones ahead. Something is going to read this vault to decide whether a
device's password is correct, and something else is going to act on that decision by
rewriting configuration on live equipment. A vault that answers "I hold no secret for that
account" when the truth is "you gave me the wrong key" would let the rest of the system
reason confidently from nothing at all.

What is pleasing is how little code it took, because the cipher was already doing the work:

``` js title="verification/src/vault.js"
  } catch {
    // The authentication tag did not check out, which for a file we wrote
    // ourselves means the passphrase is wrong.
    throw new Error("that key does not open this vault");
  }
```

GCM verifies the authentication tag before it will hand back plaintext, so a wrong key does
not yield plausible garbage — decryption fails outright. Choosing an authenticated cipher
meant this failure detected itself; all the code adds is a sentence a human can read. Had
the vault used something unauthenticated, the same requirement would have needed a
mechanism invented from scratch to tell "wrong key" from "wrong data", and that mechanism
would have been the interesting, fragile part of this article.

Note what the message does not claim. It does not say the passphrase is wrong, because from
inside the vault that is not knowable — a tag check fails identically whether the key is
wrong or the file was altered. It reports what happened: this key did not open this vault.

Everything else about failure is out of scope here by explicit choice: no repair, no
recovery, no handling of files damaged by something other than the vault itself. An empty
vault and a not-yet-created vault are ordinary successful states — `list` says the vault
holds no secrets, `get` says nothing is recorded — and that is the whole of it.

## What it protects, and what it does not

A security boundary you cannot state plainly is one you do not have, so here is this one in
full. The vault protects its contents **from someone who reads the file without the key**.
That is all it does, and it does it well: copy `vault.json` off this machine and it is
noise.

Three things it does not protect against, none of them flaws:

- **Anyone who has the key.** The vault is exactly as strong as the passphrase and wherever
  that passphrase lives. There is no second factor here.
- **Anyone who can read the memory of a process that has opened it.** A secret in use is a
  secret in plaintext somewhere. Encryption at rest is precisely that — at rest.
- **The secret after you retrieve it.** `get` prints to your terminal, where it may sit in
  scrollback for the rest of the day. That is not a flaw in `get`; it is what `get` is for.
  But it is worth knowing before you run it on a screen someone is sharing.

Two coarse facts also leak by construction, and pretending otherwise would be silly: an
encrypted file cannot hide that it exists, and its size says roughly how much is in it.

The key itself lives outside the vault and always will — supplied fresh on every
invocation, never written next to the thing it opens. Storing them together is the classic
own-goal of encryption at rest, and it is worth naming as an anti-pattern precisely because
it is so convenient to do.

## Data ownership, enforced rather than agreed

Now the architectural point, and it is the reason this article exists as its own milestone
rather than a paragraph inside the next one.

The design this series opened with drew exactly one line about plaintext: **one component
owns it.** The verification service — which arrives in the next article — is the only thing
that will ever open this vault. Everything else in the system works with hashes, verdicts,
and device configuration, and never touches a plaintext secret at all.

The component that makes this interesting is the assurance engine, two articles from here.
Its job is to log into routers and correct wrong passwords. If you were designing it
without the boundary in mind, giving it vault access would be the obvious move — it needs
to write a correct secret to a device, and the correct secret is right there in the vault.
That is a design that works, and it is the one this project refused. The engine's own
research records the temptation and the refusal in the same breath: reading the vault would
make the engine a vault reader, which its requirements forbid and which the data-ownership
boundary reserves to the verification service.

What replaces it is a question the engine asks and an answer it receives. Instead of *give
me the secret so I can write it*, the engine asks *give me a hash for the secret you hold*,
and pushes that. The plaintext never leaves the component that owns it. The engine can be
compromised, misconfigured, or wrong, and it still cannot leak what it never had.

The word doing the real work in this section's title is **enforced**. A boundary maintained
by everyone agreeing not to cross it survives exactly as long as the first inconvenient
afternoon. This one is structural in three separate ways, none of which depend on anybody
remembering:

- The engine is a different codebase in a different language, with no vault code in it at
  all — there is no import that would give it access, and its dependency list would have to
  change for one to exist.
- Its written requirements forbid vault access outright, so adding it is a documented
  reversal rather than a quiet commit.
- The vault runs where the verification service runs, and the engine reaches that service
  across a network — over which a verdict travels and a plaintext does not.

That last one is the next article's entire subject, and this one is the reason it exists.

## Keeping vaults out of git

One small habit worth stealing, best appreciated by looking at when it happened rather than
what it says.

``` text title=".gitignore"
# Secret vaults — never committed, even ones holding documented fakes
.quelaag/
*.vault.json
```

Those lines were committed in the same commit that first created a vault — before any vault
file could possibly exist, because the code that creates one arrived alongside them. That
ordering is the whole trick. An ignore rule added afterwards protects you from the next
mistake, not the one already sitting in your history, and history is the part you cannot
quietly fix once other people have cloned it. The rule covers documented fakes too, which
is deliberate: an article that shows a committed vault file has taught the habit backwards,
whatever the file contains.

The same move shows up again at the end of this series, guarding a `.env` file full of
credentials for the packaged system. Same reasoning, same ordering, and by then it should
feel like an obvious thing to do rather than a rule someone imposed.

## What you have now

Quelaag can now hold both halves of a verification. The hash comes off a device; the
known-good plaintext comes out of an encrypted file that reveals nothing without its
passphrase, replaces rather than accumulates, cannot be destroyed by a failed write, and
tells you plainly when the key you gave it does not work. Seventeen tests cover it and the
hashing library between them, none of which need a device:

``` console
$ npm test --prefix verification
# tests 17
# pass 17
# fail 0
```

What is missing is the arrangement that lets anything *use* it. Right now the only way to
ask this vault a question is to be a person, at a terminal, on this machine, typing a
passphrase into an environment variable. The thing that actually needs to ask is a program
running somewhere else, at whatever hour a router's configuration changes — and the one
thing that must never travel back to it is the plaintext it would need to check the answer
itself.

So the question becomes: what shape of thing sits in front of this vault, answers *is this
hash right?* over a network, and hands back a verdict without ever handing back a secret?
That is [the next article](04-the-verification-service.md), and it is where two pieces of
this system talk to each other for the first time.

---

*The vault exactly as this article describes it:
[quelaag-milestone-3.tar.gz](https://github.com/joshgilby/quelaag/releases/tag/milestone-3).
To watch it being built commit by commit:
[milestone-2...milestone-3](https://github.com/joshgilby/quelaag/compare/milestone-2...milestone-3)
— the commit list is this article's table of contents.*

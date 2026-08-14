---
icon: lucide/hash
---

# Reading the `$8$`

The previous article ended with a router handing you two of these and no explanation:

``` console
$ uv run scripts/list_users.py r1
Creating virtual environment at: .venv
r1: username admin, secret 8 $8$u3fGmF.bndWAAU$n8ty1Zw8T8fuO49sUj2F/SUGGb18iBpwTycZvCpv8DY
r1: username operator, secret 8 $8$WCiPyXOp22.N7E$gE9z5EgvWcw99VcgWfM9y7FXxM6EBuhhqu6V01rLvGU
```

If that line is unfamiliar, [article 1](01-you-dont-need-a-rack-of-routers.md) builds
the lab it came from; the `Creating virtual environment` line is uv noticing a fresh
download and rebuilding its pinned environment, which article 1 also explains.

You already know roughly what you are looking at: the stored form of `admin`'s
password, Cisco's type 8, sitting where plaintext must never sit. Here's the question
this series is about: Somewhere there is a record of what that password
is *supposed* to be. Given the hashed string and the authoritative record, how do you check that they
agree? Answering that continuously, across a fleet, is the whole of Quelaag. Answering
it once is this article, and that answer is about fifty lines of JavaScript with no
dependencies — plus two facts about the encoding that are difficult to discover.

One addition to the [prerequisites](before-you-start.md), which otherwise have not
changed: Node, version 22 or newer — the version this series is built and tested
against. The JavaScript in this project has no runtime dependencies and no build step,
so installing Node is the whole of it. Grab this article's archive and everything below
runs from its root:

```sh
curl -LO https://github.com/joshgilby/quelaag/releases/download/milestone-2/quelaag-milestone-2.tar.gz
tar -xf quelaag-milestone-2.tar.gz
cd quelaag-milestone-2
```

## What the string says

Take `admin`'s line apart. It contains three fields, separated by `$`:

| Field | Here | What it is |
|---|---|---|
| `8` | `8` | the format — Cisco's type 8 |
| salt | `u3fGmF.bndWAAU` | fourteen characters chosen fresh when the password was set |
| digest | `n8ty1Zw8T8fuO49…` | the result of scrambling the password together with that salt |

The scrambling is PBKDF2 with SHA-256: mix the password with the salt, hash it, hash
the result, and keep going for 20,000 rounds. Two properties make it fit for the job.
It only runs forward — there is no path from the digest back to the password, not with
the salt in hand, not with the source code, not with anything. And it is deliberately
expensive: 20,000 rounds took about two and a half milliseconds to complete on the author's
laptop. No one notices the delay
at login while an attacker guessing millions of candidates notices very much. This cost is
important because cryptographic hashes are subject to offline brute force attacks.
As a consequence, hashing a weak password offers little protection. A truly weak password -
say `Password1` - is still vulnerable, even when hashed, because it takes very few attempts
to crack it.

One-way sounds like a dead end. How do you check a password against something that
cannot be reversed? By running the only direction that works: take the password you
believe is right, scramble it with the salt stored in the hash — it is sitting right
there in the middle field — and compare the result against the digest. Same
digest, same password. That re-derive-and-compare move is all verification is, and it
is the core of everything this series builds from here.

## Why the same password never looks the same

Article 1 planted an itch on purpose: `admin` has the same password on both routers,
and the two hashes had nothing in common. Here are both, in two of the four entries of
this milestone's test fixtures — real device output, frozen into the download:

``` json
{
  "device": "r1",
  "username": "admin",
  "plaintext": "CHANGE-ME-ADMIN",
  "hash": "$8$6MDQWLA4JAG.pU$2NYhnsjdrF.A2jgvUlpYU9DYJvSHgxAND7unfHGB7WY"
},
{
  "device": "r2",
  "username": "admin",
  "plaintext": "CHANGE-ME-ADMIN",
  "hash": "$8$q9UXTeTb16P/M.$p3NFLlH4GzfJzejNAywIiHqPsPsP6AoIlKLm4wpGsf."
}
```

Same plaintext, entirely different strings — and the salt fields are why. Each device
picked its own fourteen characters when it hashed the password, so the digests cannot
match. Set the same password twice on one device and the same thing happens.

The fresh salt is deliberate, and a common practice. If identical passwords hashed identically,
anyone holding a stolen configuration could see at a glance which accounts share a
password — across a fleet, that is a map of what to try first. Worse, they could hash
a dictionary of likely passwords once and look every stolen hash up in the result. A
salt per password makes both attacks pay full price: the precomputed table is useless,
because it was computed with the wrong salts.

The consequence that shapes this whole system: **you can never compare two hashes to
each other.** Does r1 agree with r2, does the device agree with the record — none of
these is ever a string comparison. Every check means re-deriving with the salt from
the hash in hand. Redeploy the
lab and every hash changes; recapture them and the test suite still passes, because
the suite never compares hashes — it verifies them.

## The library

Here is the whole thing:

``` js title="verification/src/secrets.js" linenums="1"
import { pbkdf2Sync, randomInt, timingSafeEqual } from "node:crypto";

const ITERATIONS = 20000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 14;

// Cisco encodes with this alphabet rather than standard base64: it starts with
// "./" and has no "+" or "/" at the end. Standard base64 output is translated
// into it character by character.
const CISCO_ALPHABET =
  "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const STANDARD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toCiscoBase64(bytes) {
  const standard = bytes.toString("base64").replace(/=+$/, "");
  return [...standard]
    .map((character) => CISCO_ALPHABET[STANDARD_ALPHABET.indexOf(character)])
    .join("");
}

function digestFor(plaintext, salt) {
  // The salt's characters are the salt bytes. They are NOT base64-decoded first;
  // decoding produces a valid-looking hash that no device will ever accept.
  const derived = pbkdf2Sync(plaintext, salt, ITERATIONS, KEY_LENGTH, "sha256");
  return toCiscoBase64(derived);
}

export function generateSecret(format, plaintext) {
  const salt = Array.from(
    { length: SALT_LENGTH },
    () => CISCO_ALPHABET[randomInt(CISCO_ALPHABET.length)],
  ).join("");

  return `$8$${salt}$${digestFor(plaintext, salt)}`;
}

export function verifySecret(format, plaintext, hash) {
  const [, , salt, digest] = hash.split("$");
  const candidate = Buffer.from(digestFor(plaintext, salt));
  const stored = Buffer.from(digest);

  // Comparing byte by byte with === would leak, through how long it takes, how
  // much of the digest matched.
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}
```

The import on the first line is the milestone's quiet argument: everything
cryptographic comes from `node:crypto`, which ships inside Node. No packages, and no
lockfile either — where article 1's Python needed uv to pin netmiko and seventeen
packages underneath it, the JavaScript side pins nothing because it installs nothing.
The same reproducibility argument, in its cheapest possible form.

Two functions face the caller, and both take the secret's format as their first
argument — which deserves a moment, because the library never looks at the value. That
is not an oversight; it is the result of designing for extension without
building any of it. Other hash types are on the project's roadmap, and because every
caller already names the format it is speaking, adding one later only requires changes
to this library. The function call keeps the same interface.

The other line worth a pause is `timingSafeEqual`. Comparing digests with `===` stops
at the first byte that differs, so how long the comparison takes leaks how much of the
digest matched. Today the only caller is you at a terminal, and it will not stay that
way — this library is headed behind a network service. The right habit requires one line
now.

Watch it answer for the device hash this article opened with:

=== "What you type"

    ``` sh
    node --input-type=module -e '
    const { verifySecret } = await import("./verification/src/secrets.js");
    const hash = "$8$u3fGmF.bndWAAU$n8ty1Zw8T8fuO49sUj2F/SUGGb18iBpwTycZvCpv8DY";
    console.log("right plaintext :", verifySecret("type8", "CHANGE-ME-ADMIN", hash));
    console.log("wrong plaintext :", verifySecret("type8", "CHANGE-ME-OPERATOR", hash));'
    ```

=== "What you see"

    ``` text
    right plaintext : true
    wrong plaintext : false
    ```

Generation gets a two-line command of its own, because a hash is something you will
want on demand — and its stdin plumbing carries a rule:

``` js title="verification/src/cli.js"
// Prints a type-8 hash for the secret given on standard input.
//
// The secret arrives on stdin rather than as an argument because command lines
// are visible to every user on the host through the process table.
//
//   printf 'the-secret' | node verification/src/cli.js

import { generateSecret } from "./secrets.js";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

console.log(generateSecret("type8", chunks.join("")));
```

``` console
$ printf 'CHANGE-ME-ADMIN' | node verification/src/cli.js     # twice
$8$hzWFbzEJVLhDAi$ZELGtldvjCm6tM0VkQTNwZS8WaxO1tCInSVF/fHPb0M
$8$b/79bvfdN65qKp$BroRH6zPLNjh0SqhjTc04ZP7pMQ5wyGvOcVjkAqLf/k
```

Two runs, two salts, two different strings — both verify against `CHANGE-ME-ADMIN`,
and a device would accept either. The stdin rule is worth internalizing now, because
this series will keep it for every secret that ever crosses a process boundary: a
command-line argument is visible to every user on the host via the process table; a
process's standard input is not.

The test suite runs with one command and no lab:

``` console
$ npm test --prefix verification
ok 1 - every device hash verifies against its own plaintext
ok 2 - no device hash verifies against another plaintext
ok 3 - the same secret has different hashes on different devices
ok 4 - a generated hash verifies against the secret it came from
ok 5 - a generated hash looks like the ones devices produce
ok 6 - hashing one secret twenty times gives twenty distinct hashes
# tests 6
# suites 0
# pass 6
# fail 0
```

`node --test` is Node's built-in runner, chosen for the same zero-dependency reason as
the built-in crypto; `--prefix verification` points npm at the right directory. The
fixtures are the four captured device hashes, and the suite checks every pairing —
each hash against its own plaintext and against every other. Which leaves a fair
objection standing: a suite that runs without a lab proves the library agrees with
four strings. It cannot prove the library agrees with *Cisco*.

## The two details nobody writes down

The library above hashes exactly like a Cisco device. The first version of it did not,
and the difference is the reason this series keeps banging on about measurement.

Type 8 is publicly documented, sort of. The sources agree: PBKDF2 with SHA-256,
20,000 iterations, an 80-bit salt, base64 output. All of that is correct. None of it
is sufficient, and the gap hides in two places.

**The salt is not decoded.** An 80-bit salt encodes to fourteen base64 characters — so
when you meet fourteen base64-looking characters in the hash, the reasonable move is
to decode them back to ten bytes and hand those to the derivation. The documentation's
own correctness baits the mistake: it says 80 bits, and decoding is how you would get
80 bits. Cisco does not decode. The fourteen characters themselves are the salt,
passed to PBKDF2 as ASCII text.

**The alphabet is not standard base64.** Cisco encodes with the crypt-style alphabet
that begins `./` and drops `+/`. Standard base64 output has to be translated across,
character by character, and its `=` padding stripped.

Here is what getting it wrong looks like — the digest of this article's opening hash,
computed three ways from the same ingredients:

``` text
the device holds           n8ty1Zw8T8fuO49sUj2F/SUGGb18iBpwTycZvCpv8DY

salt used as ASCII text   n8ty1Zw8T8fuO49sUj2F/SUGGb18iBpwTycZvCpv8DY   <- matches the device
salt base64-decoded first aPq.SPnOD.SnZhfdHDp3qYQhdYhcqfcOsiRNrCn93dY   <- plausible, and wrong
standard base64 alphabet  zK5+Dl8KfKr6aGL4gvERBegSSnDKuN18f+ol7O17KPk   <- plausible, and wrong
```

Nothing about the wrong ones is malformed. Same algorithm, same 20,000 iterations,
same salt characters in hand, same length, same character set. An implementation built
faithfully from the published parameters produces the second or third line, passes its
own tests, verifies its own hashes, round-trips its own generation — and disagrees
with every Cisco device on earth, silently, forever. No error is ever raised. The
answer is simply `false` where `true` belonged, and the only way to discover that is
to hold a digest a real device produced and fail to reproduce it. That is what the
stunt-double lab is *for*, one article after it was built.

This is the turn this series keeps promising, in its first full costume: documentation
that is right, complete enough to feel authoritative, and missing exactly the details
that decide whether your output matches reality. Assertion said the implementation was
correct. Measurement said otherwise, named the two places, and the comments in
`secrets.js` now warn the next reader at both of them.

## The round trip

Reproducing device hashes settles one direction: hashes flowing from the device to the
library verify correctly. Generation flows the other way — and a later article will
push library-minted hashes onto devices as corrections, so "a device would accept it"
cannot rest on the suite's say-so. Only a device gets to say that:

``` console
$ uv run scripts/roundtrip_check.py r1
generated $8$3Zqdo2lBpVdAP9$tp8gnmF2xoMZTITYs0WVl3p7/X8f8kppKXLFJ.OaZRA
configured roundtrip on r1
logged in as roundtrip: the device accepts the library's hash
removed roundtrip
```

The script generates a hash by invoking the Node library as a subprocess from Python —
the plaintext crossing on standard input, per the rule — configures it on a throwaway
account (`roundtrip`, in the lab's documented credential table), opens a fresh SSH
session authenticating with the original plaintext, and removes the account again. The
baseline users are never touched. The login in the third line is the claim no unit
test can make: the library and IOS agree about type 8, end to end, demonstrated on
demand against the very platform the system will one day correct.

That Python-asks-JavaScript seam, crossed here by a subprocess, is also a quiet
preview. Two articles from now the same question crosses a network instead, and this
library gets a service wrapped around it — for a reason that has nothing to do with
hashing.

## Not everything should be a service

Which brings up this article's software lesson. A series about microservices has just
met its first real component, and the component is not a service. That is deliberate,
and worth dwelling on, because the opposite reflex — *we are doing services, so the
hashing should be a hashing service* — is everywhere, and it is how systems grow a
network hop in the middle of a function call.

A service earns a process of its own by owning
something: state that must live in one place, I/O it must schedule, a lifecycle
independent of its callers. This library has none of those. No state — the salt
arrives inside the hash, and nothing is remembered between calls. No I/O — its own
spec forbids it to touch a device, a vault, or the network; it computes on what it is
handed. No lifecycle — it runs exactly when its caller runs. Make it a service anyway
and the bill arrives immediately: a network round trip on every verification, a second
process to start, monitor and restart, and a genuinely new failure mode — what should
a caller conclude when the hashing service is down? — all in exchange for
nothing, because every caller everywhere gets the same answer from the same
arithmetic.

So it is a library: a function call away from whatever imports it,
incapable of being unreachable. And it stays one. When a service does appear in this
series, it will not be because hashing requirements changed. It will be
because something else needs to ask the question from across a process boundary — and
because plaintext secrets must never be allowed to travel back with the answer. The boundary
will be earned by data ownership.

## What you have now

A `$8$` string is no longer a blob. Format, salt, digest; why the middle field
guarantees you will never see the same string twice; why every check is a fresh
derivation and never a comparison. You can verify any device hash against a claimed
plaintext in a couple of milliseconds, mint hashes a real router accepts — with the router's
own testimony to prove it — and run the whole suite on a train. And you know the two
facts about type 8 that the public record omits, and exactly what it cost to learn
them from a machine instead of a document.

What you cannot do yet is the thing Quelaag actually needs. Verification takes two
inputs: the hash off the device, and the plaintext it is supposed to encode. The first
is a `show running-config` away. The second is currently — where, exactly? A password
manager? A spreadsheet? Someone's memory? For a system that intends to verify secrets
continuously, the known-good plaintext has to live somewhere a program can reach, and
every property of that somewhere — what encrypts it, who may read it, where its key
lives — matters enormously. That somewhere is [the next article](03-a-vault-for-known-good-secrets.md).

---

*The library exactly as this article describes it:
[quelaag-milestone-2.tar.gz](https://github.com/joshgilby/quelaag/releases/tag/milestone-2).

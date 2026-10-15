---
icon: lucide/vault
---

![Drafting](/assets/images/03-vault-l.png#only-light)
![Drafting](/assets/images/03-vault-d.png#only-dark)

# A vault for known-good secrets

[The last article](02-reading-the-8.md) built a library that builds and verifies hashes from
a plaintext password. The router holds the hash in its configuration, the `$8$` string, but
where does the known-good password come from? The plaintext passwords need to be stored
somewhere that Quelaag can access, and this article builds that store: an encrypted file on
local disk with an entry per service and username.

It is also the first article in this series you can run without a router. The vault touches
no device, so if the licensed image in [before you start](before-you-start.md) is unavailable,
that does not matter. This article, and the next, run in full. Everything below runs from
the archive:

```sh
curl -LO https://happypathnetworking.com/assets/releases/quelaag-milestone-3.tar.gz
tar -xf quelaag-milestone-3.tar.gz
cd quelaag-milestone-3
```

## Three simple tasks

The vault does three things, each with their own argument:

- `vault-cli.js put` creates or overwrites a stored password
- `vault-cli.js get` fetches a stored password
- `vault-cli.js list` lists the stored passwords

From the release root, seed the password vault:
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

Those passwords are the lab's documented fakes from article 1, so nothing here is truly secret.
`QUELAAG_VAULT_PATH` is optional; left unset, the vault lives at `~/.quelaag/vault.json`.
The tests specify a path to avoid overwriting a production vault. An entry is identified by
the pair — service and username; there is no history.

Now look at how the secret and the passphrase are passed.  The passphrase arrives in an
environment variable and the secret on standard input, and **neither is ever a command-line
argument**. Article 2 introduced that rule for the hashing CLI; here is the concrete reason,
which is specific to Linux and worth knowing precisely:

`/proc/<pid>/cmdline` is world-readable, so an argument is visible to every user on the
host for as long as the process runs, and to anyone running `ps` at the right moment. The
process environment, `/proc/<pid>/environ`, is readable only by the account that owns it.
Run `ps -axe`, and you will see processes with arguments and environment variables,
but environment variables are only included for processes that your user has read access for.
If you need to keep something secret from other processes that you start, use STDIN rather
than environment variables.

## What is actually on disk

Take a look at the vault file:

``` console
$ ls -l $QUELAAG_VAULT_PATH
-rw------- 1 jgilby jgilby 190 Aug 10 16:03 …/vault.json

$ cat $QUELAAG_VAULT_PATH
{"salt":"jRGfszRocI9q4NJSGOcdPA==","iv":"M/5KYcHz8NrQ4OWd","tag":"QsPUZy1gD9W4K25D85N8Hw==","data":"BOfUgDR2u8Cznz9eHEGPDt7XT1fEiCpiLv/dKKU7VW2wodXGto4t4rpYy7mHUM3hyhZewkWFMWPHJgKbbtKS8DgP"}
```

Two things to notice before the fields. The permissions are `-rw-------`: owner only,
explicitly set when the file is created, and `data` is one blob. The whole vault — every secret,
service name and username — is encrypted as a whole. The file does not disclose that `r1` exists
or that it has an account called `admin`.

The other three fields are not secret:

| Field | What it is | Why it is safe in the clear |
|---|---|---|
| `salt` | 16 random bytes, fixed when the vault was created | needed to re-derive the key from your passphrase |
| `iv` | 12 random bytes, **fresh on every write** | needed to decrypt; reusing one increases the risk pattern recognition attacks |
| `tag` | the cipher's authentication tag | proves the file has not been altered |

Run `cat` again after any `put` and the whole line will have changed, including `iv` and
`tag`. — a fresh initialisation vector per write is a requirement of the cipher, whereas the salt
can remain the same.

The cipher is AES-256-GCM, from Node's built-in `crypto`, still avoiding dependencies.

## A passphrase is not a key

This step is easy to skip but greatly improves key strength:

``` js title="verification/src/vault.js"
  const salt = envelope ? Buffer.from(envelope.salt, "base64") : randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(12);
```

AES-256 uses a 32 byte key. What an operator types is a passphrase — usally the wrong
length, and with much less entropy than 32 random bytes. Handing that string to the cipher
directly, padded or truncated to fit, is less secure.

`scryptSync` stretches the passphrase into a proper key, and it is deliberately expensive
to run — around forty milliseconds on the author's laptop. That is
some fifteen times the cost of verifying a single hash in [article 2](02-reading-the-8.md).
At a terminal you will not notice. Someone working through a dictionary against a
stolen vault file will since the cost is incurred on every guess. This reduces the effectiveness
of an offline attack.

The salt in the file does the same thing we saw before. Article 2's hashes carried a
per-password salt so that one precomputed table could not attack every password at once;
this is the same defence at the file level. Every quelaag vault ever created has its own
random salt, so an attacker cannot build one table of stretched passphrases and try it
against all of them. And, exactly as with the type-8 hashes, the salt must be stored in the
clear or the same passphrase could never re-derive the same key.

## A write that cannot destroy the vault

The vault is the system's source of truth. If a write is interrupted halfway, a truncated
file does not lose one secret — it loses all of them, and nothing else in the system holds
a copy. So the file is never written in place:

``` js title="verification/src/vault.js"
  // Write beside the vault and rename over it: a rename is atomic, so an
  // interrupted write leaves the previous vault whole rather than truncated.
  const pending = `${path}.pending`;
```

Write the new vault to a neighbouring file, then rename it over the old one. A rename
within a directory is atomic on Linux, so at every instant the vault file is either
entirely the old version or entirely the new one.

## A locked vault is not an empty vault

This milestone stays on the happy path with one exception:

``` console
$ QUELAAG_VAULT_KEY='the-right-passphrase' node verification/src/vault-cli.js get r1 admin
CHANGE-ME-ADMIN

$ QUELAAG_VAULT_KEY='not-the-passphrase' node verification/src/vault-cli.js get r1 admin
that key does not open this vault
```

A wrong key must never produce what looks like an empty vault. If every lookup failure is
interpreted as "I hold no secret for that account", then passing the wrong key would let
the rest of the system reason confidently from nothing at all.

And it requires very little code, because the cipher already makes the check:

``` js title="verification/src/vault.js"
  } catch {
    // The authentication tag did not check out, which for a file we wrote
    // ourselves means the passphrase is wrong.
    throw new Error("that key does not open this vault");
  }
```

GCM verifies the authentication tag before it will hand back plaintext, so a wrong key does
not yield plausible garbage — decryption simply fails. Choosing an authenticated cipher
meant this failure detected itself; the code just hadles the exception by notifying the 
operator. Had the vault used something unauthenticated, the same requirement would have needed
a mechanism to tell "wrong key" from "wrong data".

Note what the message does not claim. It does not say the passphrase is wrong, because a
tag check fails whether the key is wrong or the file was altered. It sticks to the facts:
this key did not open this vault.

## What it protects, and what it does not

The vault protects its contents **from someone who reads the file without the key**.
That is all it does, and it does it well: procure a copy `vault.json` and it is
noise.

Three things it does not protect against, none of them flaws:

- **Anyone who has the key.** The vault is exactly as strong as the passphrase and wherever
  that passphrase lives. There is no second factor here.
- **Anyone who can read the memory of a process that has opened it.** A secret in use is a
  secret in plaintext somewhere. Encryption at rest is precisely that — at rest.
- **The secret after you retrieve it.** `get` prints to your terminal, where it may sit in
  scrollback.

Two coarse facts also leak by construction: an
encrypted file cannot hide that it exists, and its size says roughly how much is in it.

## Data ownership, enforced rather than agreed

Now the architectural point:

The design this series opened with drew one requirement about plaintext: **one component
owns it.** The verification service — which is the next article — is the only thing
that will ever open this vault. Everything else in the system works with hashes, verdicts,
and device configuration, and never touches a plaintext secret at all.

The component that makes this interesting is the assurance engine, two articles from here.
Its job is to log into routers and correct wrong passwords. If you were designing it
without the boundary in mind, it would be tempting to give it access to the vault. After
all, it needs to write a correct secret to a device, and the correct secret is in the vault.
While that design works, it exposes poaintext secrets to a larger code base, and potentially
to a larger infrastructure footprint.

Instead of asking for the secret itself, the engine asks for a hash of the secret and pushes
that. The plaintext never leaves the verification service. The engine can be
compromised, misconfigured, or defective, and it still cannot leak a password.

The salient term in the title is **enforced**. A boundary maintained
by everyone agreeing not to cross it is a weak boundary indeed. 
This one is structural in three separate ways:

- The engine is a different codebase in a different language, with no vault code in it at
  all — there is no import that would give it access, and its dependency list would have to
  change for one to exist.
- Its written requirements forbid vault access outright, so adding it is a documented
  reversal rather than a quiet commit.
- The vault runs where the verification service runs, and the engine reaches that service
  across a network — over which a verdict travels and a plaintext does not.

That last one is the subject of the next article.

## Keeping vaults out of git

One small habit worth forming now:

``` text title=".gitignore"
# Secret vaults — never committed, even ones holding documented fakes
.quelaag/
*.vault.json
```

Those lines keep secrets out of your git repository. The same idea shows up again at the
end of the series, guarding a `.env` file full of credentials for the packaged system.
This is for the same reason, as envornment files are a common method for passing secrets
to a containerized application.

## What you have now

Quelaag now handles both halves of a verification. The hash comes from a device; the
known-good plaintext comes from an encrypted file.  Seventeen tests cover it and the
hashing library between them, none of which need a device:

``` console
$ npm test --prefix verification
# tests 17
# pass 17
# fail 0
```

What is missing is the arrangement that lets anything *use* it. Right now the only way to
ask this vault a question is from a terminal on this machine with the vault passphrase in an
environment variable. What actually needs to ask is a program
running somewhere else, at whatever hour a router's configuration changes — and the
plaintext cannot be sent back.

So the question becomes: what sits in front of this vault and answers *is this
hash right?* over a network, without ever handing back a secret?
That is [the next article](04-the-verification-service.md), and it is where two pieces of
this system talk to each other for the first time.

---

*The vault exactly as this article describes it:
[quelaag-milestone-3.tar.gz](https://happypathnetworking.com/assets/releases/quelaag-milestone-3.tar.gz).*                                     

---
icon: lucide/flask-conical
---

![Drafting](/assets/images/01-alive-l.png#only-light)
![Drafting](/assets/images/01-alive-d.png#only-dark)

# You don't need a rack of routers

Movie directors keep stunt doubles around to film scenes that are too risky for the stars.
Network operators face the same problem but are rarely afforded a double to stand in: risky work is rehearsed
in production, carefully, outside business hours, because the alternative is a lab of real hardware
that costs real money and lives in a rack somewhere doing nothing most of the time.

This series walks through building Quelaag — a system that notices when a device's credentials drift
from the recorded truth and corrects them; [the first article](00-designing-before-building.md)
drew the design. A system like that cannot be developed against production. It will not be
developed against assertions either: everything in this series gets measured on a real network OS.
Observing real outcomes often surfaces incorrect assumptions that must be addressed before moving to production.
This is critical for establishing trust in your automations.

So this article builds the stunt double: two Cisco routers running real IOS on your
laptop, defined in one file, started with one command, halted with another.
By the end of this article you will have the lab up, a
script that reads something interesting off a live device, and — critically — an
understanding of how *not* to reboot a virtual router. There are three obvious ways,
and two are very wrong: they produce misleading output instead of failing.

## The one thing you bring

The lab devices run Cisco IOL — IOS built to run as an ordinary Linux process. Cisco
distributes IOL via the reference platform ISO of CML-Free, licensed for use within
CML, which is why this series provides no image.
You download the ISO from Cisco
and run a script in the lab to turn it into the container
image everything here uses.

To be clear: without that image you can read through the articles, but cannot run the lab, or the demonstrations in later articles that use it.
Some article demonstrations do not require a
device, so will work regardless. The prerequisites page says which.

The full setup — the tools, their minimum versions, the image build — lives on the
[before you start](before-you-start.md) page, shared by every article in the series. It
takes about fifteen minutes to set up and will carry you through the series.

## The whole network is one file

Download this article's archive and unpack it:

```sh
curl -LO https://happypathnetworking.com/assets/releases/quelaag-milestone-1.tar.gz
tar -xf quelaag-milestone-1.tar.gz
cd quelaag-milestone-1
```

The network it contains is this, in full:

``` yaml title="lab/topology.clab.yml"
name: quelaag

mgmt:
  network: quelaag-mgmt
  ipv4-subnet: 192.0.2.0/24

topology:
  kinds:
    cisco_iol:
      image: quelaag/cisco_iol:lab
  nodes:
    r1:
      kind: cisco_iol
      mgmt-ipv4: 192.0.2.11
      startup-config: configs/r1.partial.cfg
    r2:
      kind: cisco_iol
      mgmt-ipv4: 192.0.2.12
      startup-config: configs/r2.partial.cfg
  links:
    - endpoints: ["r1:Ethernet0/1", "r2:Ethernet0/1"]
```

That file is a [containerlab](https://containerlab.dev) topology. containerlab reads it
and does four things: creates the management network, starts one container per node, wires
the point-to-point link between the two `Ethernet0/1` interfaces, and generates each
device's baseline configuration.

!!! info "On Containers"

    If containers are new territory: a container is not a
    virtual machine. It is an ordinary Linux process — here, essentially IOS itself — wrapped
    in its own private filesystem and network interfaces. That is why each router only requires about
    a gigabyte of memory.

The management network is `192.0.2.0/24` — TEST-NET-1.
`r1` is `.11` and `r2` is `.12`, and will not change throughout this series.

The `startup-config` lines point at the interesting part:

``` text title="lab/configs/r1.partial.cfg"
! Baseline configuration for lab device r1 — merged into containerlab's generated
! config, which supplies the hostname, management addressing, and SSH keys.
!
! The secrets below are documented fakes (the authoritative list lives in
! lab/README.md); the device stores each one as a type-8 hash at boot.
username admin privilege 15 algorithm-type sha256 secret CHANGE-ME-ADMIN
username operator privilege 1 algorithm-type sha256 secret CHANGE-ME-OPERATOR
!
ip scp server enable
```

Two local users with non-production passwords, declared `algorithm-type sha256` so the
device stores each one as a type-8 hash at boot. Those hashes are the main subject of the
entire series — the thing that will drift, get verified, and get corrected. `ip scp server
enable` is here to enable the transfer of configuration over SCP later.
r2's file is identical apart from the comment.

!!! warning "Partial Configs"

    The file is a *partial* on purpose. containerlab's `cisco_iol` kind generates a base
    configuration — hostname, management VRF and addressing, SSH keys — and merges this file
    into it. Supply a full configuration instead and you replace that template, and the device
    boots with no management address.

Starting the lab requires one command:

``` sh title="lab/up.sh"
#!/bin/sh
# Start the quelaag lab: two IOL devices booting their baseline configurations.
cd "$(dirname "$0")"
sudo containerlab deploy -t topology.clab.yml
```

That is the whole thing, for now — `sudo` is containerlab's requirement. You can set up
[containerlab without sudo](https://deepwiki.com/srl-labs/containerlab/7.9-sudo-less-operation-and-suid),
but that requires SUID permissions, which can be a security concern.
`lab/down.sh` is the mirror image, `containerlab destroy --cleanup`, and removes
everything `up.sh` created.

??? example "Output from a lab deployment"

    ``` console
    $ ./lab/up.sh
    [sudo: authenticate] Password:
    12:44:46 INFO Containerlab started version=0.77.0
    12:44:46 INFO Parsing & checking topology file=topology.clab.yml
    12:44:46 INFO Creating docker network name=quelaag-mgmt IPv4 subnet=192.0.2.0/24 IPv6 subnet="" MTU=0
    12:44:46 INFO Creating lab directory path=/tmp/quelaag-milestone-1/lab/clab-quelaag
    12:44:46 INFO Creating container name=r2
    12:44:46 INFO Creating container name=r1
    12:44:47 INFO Running postdeploy actions for Cisco IOL 'r1' node
    12:44:47 INFO Created link: r1:eth1 (Ethernet0/1) ▪┄┄▪ r2:eth1 (Ethernet0/1)
    12:44:47 INFO Running postdeploy actions for Cisco IOL 'r2' node
    12:44:47 INFO Adding host entries path=/etc/hosts
    12:44:47 INFO Adding SSH config for nodes path=/etc/ssh/ssh_config.d/clab-quelaag.conf
    ╭─────────────────┬───────────────────────┬─────────┬────────────────╮
    │       Name      │       Kind/Image      │  State  │ IPv4/6 Address │
    ├─────────────────┼───────────────────────┼─────────┼────────────────┤
    │ clab-quelaag-r1 │ cisco_iol             │ running │ 192.0.2.11     │
    │                 │ quelaag/cisco_iol:lab │         │ N/A            │
    ├─────────────────┼───────────────────────┼─────────┼────────────────┤
    │ clab-quelaag-r2 │ cisco_iol             │ running │ 192.0.2.12     │
    │                 │ quelaag/cisco_iol:lab │         │ N/A            │
    ╰─────────────────┴───────────────────────┴─────────┴────────────────╯
    ```

Two things in that output deserve a mention. The deployment takes about two seconds, and
the devices then take up to two minutes to boot — the table says `running` long before
either answers SSH, which is normal and not a fault. And the lines touching `/etc/hosts`
and `/etc/ssh/ssh_config.d/` are containerlab writing name resolution and an SSH
configuration drop-in for you, so `ssh clab-quelaag-r1` works by name.

``` console
$ containerlab inspect -t lab/topology.clab.yml
12:45:59 INFO Parsing & checking topology file=topology.clab.yml
╭─────────────────┬───────────────────────┬─────────┬────────────────╮
│       Name      │       Kind/Image      │  State  │ IPv4/6 Address │
├─────────────────┼───────────────────────┼─────────┼────────────────┤
│ clab-quelaag-r1 │ cisco_iol             │ running │ 192.0.2.11     │
│                 │ quelaag/cisco_iol:lab │         │ N/A            │
├─────────────────┼───────────────────────┼─────────┼────────────────┤
│ clab-quelaag-r2 │ cisco_iol             │ running │ 192.0.2.12     │
│                 │ quelaag/cisco_iol:lab │         │ N/A            │
╰─────────────────┴───────────────────────┴─────────┴────────────────╯
```

Two routers, running, addressed. Why two? So that the network behaves
like a fleet — we will use this property later.

## The first script

Now that the lab is up, it's time to interact with it programmatically. This short script logs into a device and prints its local
users:

``` py title="scripts/list_users.py" linenums="1"
"""Print the local users configured on a lab device.

Usage: uv run scripts/list_users.py r1
"""

import sys

from netmiko import ConnectHandler

DEVICES = {
    "r1": "192.0.2.11",
    "r2": "192.0.2.12",
}

# The lab's documented fake credentials — the authoritative list is in lab/README.md.
USERNAME = "admin"
PASSWORD = "CHANGE-ME-ADMIN"


def fetch_username_lines(device_name):
    connection = ConnectHandler(
        device_type="cisco_xe",
        host=DEVICES[device_name],
        username=USERNAME,
        password=PASSWORD,
    )
    output = connection.send_command("show running-config | include ^username")
    connection.disconnect()
    return output.splitlines()


def main():
    device_name = sys.argv[1]
    for line in fetch_username_lines(device_name):
        # A username line reads: username <name> privilege <n> secret 8 <hash>
        words = line.split()
        name = words[1]
        secret_hash = words[-1]
        print(f"{device_name}: username {name}, secret 8 {secret_hash}")


if __name__ == "__main__":
    main()
```

The logic is straightforward — SSH to a device, `show running-config | include
^username`, split, print. netmiko, the library doing the SSH, is the one network
engineers are most likely familiar with: it knows device prompts and paging, and `send_command` hands back
the output as a string. What may not be familiar is the way the script is invoked, with `uv run`.

Here, `uv` is all about managing the Python environment. The project declares its one dependency —
netmiko — in `pyproject.toml`, and pins the exact version of *everything*, netmiko and
every package underneath it, in a lockfile called `uv.lock`. On first run, uv builds a
private environment from those pins; on every later run it reuses it. You never create,
activate, or think about a virtualenv, and everyone who runs this script runs identical
code — a lockfile is the difference between a casual listing of requirements and a precise bill of
materials. You can watch it happen on the first run:

``` console
$ uv run scripts/list_users.py r1
Using CPython 3.14.4 interpreter at: /usr/bin/python3
Creating virtual environment at: .venv
Installed 18 packages in 157ms
r1: username admin, secret 8 $8$1voYcxCzgJe3fk$Z4kRYP2QbB7qGsyiMIk1tIyZ42.Rq.zXGGvbYNEpfq2
r1: username operator, secret 8 $8$gJN1Zi1MgIvmQk$jPtST6f.5aUc9hdlG5KyjkD0OB6KuTykDKvdcG7Y9P6
```

The environment build is those first three lines and happens once. Against the other
router it is instant:

``` console
$ uv run scripts/list_users.py r2
r2: username admin, secret 8 $8$QaXfD3egD1Nbi.$Z5lW5TGBGduM7b8mxq3gHIir5.OuvPlmdE8Lqhxyh.Y
r2: username operator, secret 8 $8$6hHdBon4R./1Z.$fPFWQRfecjw72jm1u5VW8b5f1sBRdDqudXnBzMwxXX.
```

That's what we're going to manage, sitting on your screen: `$8$…` strings where
passwords ought to be. Look closer and something should itch. `admin` has the *same
password* on both routers — the baseline sets both to `CHANGE-ME-ADMIN` — and the two
hashes are very different. Yours, off the same baseline, will match neither. What that
string actually is, and how you could ever check one against the password it supposedly
protects, is a topic for the next article. For now it is enough that they are real:
generated by IOS itself, at boot, on your machine.

## Your network needs a stunt double

Software teams solved their version of this problem long ago and gave it a name. When code
under test depends on something inconvenient — a payment processor, a mail server — the
test runs against a *test double*: a stand-in that answers enough like the real thing for
the test to mean something. Doubles are so routine that many frameworks generate them as a matter of course. But the
convention has a blind spot: the external system your software exists to manage rarely
gets one. Network automations get tested against production, or not at all.

This lab is the double, and what makes it worth an article is the property many doubles
lack: it is not an imitation. The thing parsing your configuration is IOS. A mock router
answers the way its author expects a router to answer, and expectations are precisely what
need checking — a mock can only confirm what you already believe. Everything in this
series is developed against this lab rather than a mock, and that has proven to be necessary.
In several cases a real device produced unexpected outcomes, including one that shows up later in this article.

Parity has limits, and a double is only useful if you know where they are. What the lab
reproduces faithfully is the management plane — the CLI and its parser, type-8 hashing,
SSH and SCP, configuration semantics — which is the plane this whole system lives on. What
it does not reproduce: forwarding performance, hardware, scale. And there are particular nuances.
IOL treats its configuration register unlike any physical router, which the reboot
script below has to work around, and the container wrapped around each device is a place
where the double and the real thing genuinely differ — the next section demonstrates that
the hard way.

One more property earns its keep quietly. The lab is reproducible in its entirety: the
topology is a file, the addresses are static, the dependencies are locked, the image build
is scripted. Nothing depends on this author's machine, so what you see is what these
articles show. And a redeploy returns the devices to an exact known state — a fact that
cuts both ways, as you are about to see.

## How not to reboot a virtual router

A later article in this series will make a claim: *the correction survives a
reboot*. Nobody who operates networks takes that sort of claim on faith — you reboot the
box and look. This raises a question with more wrong answers than right ones: how do you
reboot a router that runs inside a container?

### The container is not the device

The first option is to restart the container. Let's confirm `r1` is running and reachable before restarting it:

``` console
$ docker ps --format 'table {{.Names}}\t{{.Status}}'
NAMES             STATUS
clab-quelaag-r1   Up 14 minutes
clab-quelaag-r2   Up 14 minutes

$ uv run scripts/list_users.py r1        # reachable
r1: username admin, secret 8 $8$iHie/Mkf0ebUSk$wzP1TwMFqt/nRAywcrgFIwE.WX6f3NkhxQwcYwHmAlY
r1: username operator, secret 8 $8$6LIWrXwN9NvnXU$Uwce8T1ClDDHO4uoh909xJOGnaDdHkZ4Mngg3Pkd2JI

$ docker restart clab-quelaag-r1
clab-quelaag-r1
```

Wait the couple of minutes a real device takes to boot, then check on it:

``` console
$ docker ps --format 'table {{.Names}}\t{{.Status}}'    # the container is fine
NAMES             STATUS
clab-quelaag-r1   Up 2 minutes
clab-quelaag-r2   Up 17 minutes

$ ping -c 3 -W 2 192.0.2.11

--- 192.0.2.11 ping statistics ---
3 packets transmitted, 0 received, 100% packet loss, time 2039ms

$ uv run scripts/list_users.py r1        # and yet
Device settings: cisco_xe 192.0.2.11:22

Traceback (most recent call last):
  File "/tmp/quelaag-milestone-1/.venv/lib/python3.14/site-packages/netmiko/base_connection.py", line 1139, in establish_connection
    self.remote_conn_pre.connect(**ssh_connect_params)
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^
  File "/tmp/quelaag-milestone-1/.venv/lib/python3.14/site-packages/paramiko/client.py", line 407, in connect
    raise NoValidConnectionsError(errors)
paramiko.ssh_exception.NoValidConnectionsError: [Errno None] Unable to connect to port 22 on 192.0.2.11
During handling of the above exception, another exception occurred:
```

The container is healthy. The device booted perfectly. Nothing can reach it, and nothing
ever will. Inside that container live two processes: `iol.bin`, which is the device, and
`iouyap`, a daemon that bridges the device's interfaces to the container's network. The
restart brings back `iol.bin` without `iouyap`, and the veth pair carrying the data link
died with the container's first life — so IOS boots normally, wired to nothing. From the
outside that is indistinguishable from a router that hung on boot, and the tempting conclusion
— *the reboot broke it* — is wrong. The device is fine. It is also unreachable until you
rebuild the lab, because nothing short of a redeploy restores the plumbing.

!!! warning "`docker restart` is not a reboot"

    It restarts the container, not the device, and leaves the device cut off until the
    next `./lab/down.sh && ./lab/up.sh`.

Sharp eyes will have noticed the hashes in that transcript match nothing shown so far.
Hold that thought.

### A redeploy restores defaults

The second option is to redeploy the lab.
`./lab/down.sh && ./lab/up.sh` comes back clean every time — but `destroy --cleanup`
deletes the lab's working directory, including each node's NVRAM and generated boot
configuration, and `up.sh` regenerates that configuration from the topology file and the
partials, whose secrets sit in plaintext for the device to rehash:

``` console
$ uv run scripts/list_users.py r1
r1: username admin, secret 8 $8$u3fGmF.bndWAAU$n8ty1Zw8T8fuO49sUj2F/SUGGb18iBpwTycZvCpv8DY
r1: username operator, secret 8 $8$WCiPyXOp22.N7E$gE9z5EgvWcw99VcgWfM9y7FXxM6EBuhhqu6V01rLvGU
```

Back to baseline with new hashes. Whatever was configured before is — gone.
This behavior makes a redeploy incapable
of demonstrating persistence: it returns the device to baseline *by construction*, so
checking a persistence claim with it always answers "nothing survived", whatever the
truth was. Correct evidence, guaranteed wrong conclusion.

### The real reboot, and the hashes that move anyway

What is left is restarting the device without touching its wrapper, and that is what the
lab's reboot script does: it tells IOS to reload, in place.

``` console
$ docker inspect clab-quelaag-r1 --format '{{.State.StartedAt}} restarts={{.RestartCount}}'
2026-08-10T16:25:04.913541818Z restarts=0

$ uv run scripts/reboot_device.py r1
r1: reloading
r1: waiting for it to come back (this takes a few minutes)
r1: back

$ docker inspect clab-quelaag-r1 --format '{{.State.StartedAt}} restarts={{.RestartCount}}'
2026-08-10T16:25:04.913541818Z restarts=0
```

Same container start time, zero restarts, and about two and a half minutes of genuine IOS
boot in between: the container never blinked, and the device rebooted. Two IOL quirks make
the script less trivial than it sounds — IOL refuses `reload` over SSH unless the
configuration register's boot bits are set, and it forgets the register on every boot, so
the script sets `config-register 0x2102` immediately before each reload. That is one of
the seams where the double is not the real thing, known and worked around.

Now list the users again:

``` console
$ uv run scripts/list_users.py r1
r1: username admin, secret 8 $8$h986.pNw4hu1zU$wR/tTm3morTZ8QQdAKJw6AIeAsnAilQz7draWtEBVe2
r1: username operator, secret 8 $8$M00f7axioyRx3k$OfH.MlvVXaTwwDas5x2CsbAMcPD8w3uc7Aqg1OOmNY2
```

Every hash is new. That listing is the same deployment as the one in the first-script
section, and between the two the device did nothing but genuinely reboot — yet every
secret on it re-hashed anyway. A persistence check here would conclude that nothing
survives even a real reboot. This is the third tempting wrong conclusion, and the
subtlest, because this time the reboot was the right one.

The cause: nothing committed the baseline to `startup-config`, of course! Until something writes NVRAM there is no
startup configuration, so every boot re-applies the generated boot config — where the
secrets are plaintext — and the device hashes them again with a fresh salt each time. Same
passwords, new strings, every single boot.

So save, then reboot:

``` console
$ uv run scripts/list_users.py r1     # before
r1: username admin, secret 8 $8$h986.pNw4hu1zU$wR/tTm3morTZ8QQdAKJw6AIeAsnAilQz7draWtEBVe2
r1: username operator, secret 8 $8$M00f7axioyRx3k$OfH.MlvVXaTwwDas5x2CsbAMcPD8w3uc7Aqg1OOmNY2

$ ssh admin@192.0.2.11 'write memory'

$ uv run scripts/reboot_device.py r1
r1: reloading
r1: waiting for it to come back (this takes a few minutes)
r1: back

$ uv run scripts/list_users.py r1     # after
r1: username admin, secret 8 $8$iHie/Mkf0ebUSk$wzP1TwMFqt/nRAywcrgFIwE.WX6f3NkhxQwcYwHmAlY
r1: username operator, secret 8 $8$6LIWrXwN9NvnXU$Uwce8T1ClDDHO4uoh909xJOGnaDdHkZ4Mngg3Pkd2JI
```

They moved *again* — which looks, briefly, like saving does not help. The clue that tells us
what really happened is subtle: look at the `write memory` line.
It printed nothing. A successful configuration save says so — `Building configuration...
[OK]` — and this one, sent as a one-shot SSH command, silently never ran. The empty line
was the tell.

Now connect to `r1`, save the configuration manually, watch for the `[OK]`:
``` console
 ssh admin@192.0.2.11
(admin@192.0.2.11) Password:


r1#wr mem
Building configuration...
[OK]
r1#exit
Connection to 192.0.2.11 closed by remote host.
Connection to 192.0.2.11 closed.
```

Finally, reboot a third time:

``` console
$ uv run scripts/list_users.py r1     # before
r1: username admin, secret 8 $8$iHie/Mkf0ebUSk$wzP1TwMFqt/nRAywcrgFIwE.WX6f3NkhxQwcYwHmAlY
r1: username operator, secret 8 $8$6LIWrXwN9NvnXU$Uwce8T1ClDDHO4uoh909xJOGnaDdHkZ4Mngg3Pkd2JI

$ uv run scripts/reboot_device.py r1
r1: reloading
r1: waiting for it to come back (this takes a few minutes)
r1: back

$ uv run scripts/list_users.py r1     # after
r1: username admin, secret 8 $8$iHie/Mkf0ebUSk$wzP1TwMFqt/nRAywcrgFIwE.WX6f3NkhxQwcYwHmAlY
r1: username operator, secret 8 $8$6LIWrXwN9NvnXU$Uwce8T1ClDDHO4uoh909xJOGnaDdHkZ4Mngg3Pkd2JI
```

Byte-identical, both users. NVRAM wins, and persistence across a reload is now something this lab can
genuinely demonstrate — with the one reboot that is a reboot, on a device that has
a saved startup configuration.

## What you have now

In the last section we ran three plausible checks, with three wrong conclusions on
offer. A healthy device indistinguishable from a hang. A factory reset masquerading as
evidence of loss. Hashes that moved when nothing had changed — and, inside that one, a
save that silently never happened. None of it came from documentation;
it came from running the operations and reading the output,
including the empty line where an `[OK]` should have been. That habit — measure, then look
hard at what the measurement actually says — is employed throughout this series, and this was
its first demonstration on real equipment. The stakes only go up from here.

You also have the thing the series needed: a two-router network that boots to a known
state in two minutes, reboots for real, tears down without a trace, and costs nothing
beyond a free download. Every address in it is publication-safe,
every credential a documented fake, and everyone who builds it gets the same lab — which
is what lets every later article say *run this, and you will see what I saw*.

And those `$8$` strings are still on the screen. The same password became a different
string on every device and every boot, and the system this series is building must
eventually decide whether such a string is *right*. What a type-8 hash actually is, and
how you check one against the password it is supposed to protect, is
[the next article](02-reading-the-8.md).

---

*The lab exactly as this article describes it:
[quelaag-milestone-1.tar.gz](https://happypathnetworking.com/assets/releases/quelaag-milestone-1.tar.gz).*

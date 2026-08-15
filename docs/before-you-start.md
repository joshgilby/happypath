# Before you start

Every article in this series runs against the same two-device lab on your own machine.
Setting it up once is the only prerequisite, and this page is the whole of it.

If you would rather just read, that works too — the articles quote real output from real
devices throughout, so nothing is hidden behind a setup step. But the lab is cheap and the
series is much better with it.

## What you need

On a Linux host, or Windows via WSL2:

- **Docker** — the devices run as containers
- **containerlab** — builds and wires the topology
- **uv** — runs the Python scripts, and installs their exact pinned dependencies for you
- **Node** — from article 2 onward. The JavaScript here has no runtime dependencies at
  all and no build step, so a recent Node is the whole of it
- **About 4 GB of free memory**, and `sudo`, which containerlab needs

Exact minimum versions are in `lab/README.md` inside the download, checked at the top of
the file. They are listed there rather than here so there is one copy to keep current.

## The image is bring-your-own

The lab devices run Cisco IOL, and **this project cannot ship it**. Cisco distributes IOL
in the reference platform ISO of CML-Free, licensed for use within CML, so the repository
contains no image, no binary, and a `.gitignore` that blocks either from ever being
committed. You download the ISO with your own account and a script does the rest.

Getting it takes **about thirty minutes**, most of that download:

1. Sign in at [developer.cisco.com/modeling-labs](https://developer.cisco.com/modeling-labs/)
   and get the CML-Free **reference platform ISO**. A free Cisco account is enough.
2. Unzip it — Cisco ships the ISO inside a zip.
3. Run the build script against it. It extracts the IOL binary, fetches the tooling that
   packages it, and produces the container image containerlab expects:

    ```sh
    unzip ~/Downloads/refplat-<version>-free-iso.zip -d ~/Downloads
    ./lab/build-image.sh ~/Downloads/refplat-<version>-free.iso
    ```

That is once, ever. Every article after this reuses the same image.

!!! warning "There is no substitute image, and there will not be one"

    A mock device was considered and deliberately rejected, so without the ISO you
    cannot run the lab. That is a real limitation and it is better said here than
    discovered three articles in.

    It is not the whole series, though. Roughly half of it never touches a device:

    | Article | Runs without the lab? |
    |---------|-----------------------|
    | 1 — the lab | No. It is the lab |
    | 2 — the library | Yes, apart from the round-trip demonstration at the end |
    | 3 — the vault | Entirely |
    | 4 — the verification service | Entirely |
    | 5a, 5b — the engine | No. It exists to change devices |
    | 6a, 6b — the receiver, and shipping it | No |

    Articles you cannot run still quote real output throughout, so nothing is hidden.

## Then

```sh
./lab/up.sh          # two routers, about two minutes to boot
./lab/down.sh        # when you are done
```

The deploy itself takes seconds. The devices take a couple of minutes after that before
they answer SSH — containerlab will report them `running` well before they are usable,
which is normal and not a fault.

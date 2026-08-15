# Before you start

Every article in this series runs against the same two-device lab on your own machine.
Setting it up once is the only prerequisite, and this page covers it all.

If you would rather just read, that works too — the articles quote real output from real
IOL devices throughout, so nothing is hidden. However, the lab is easy to set up and the
series is much better with it.

## What you need

On a Linux host, or Windows via WSL:

- **Docker** — the devices run as containers
- **containerlab** — builds and wires the topology
- **unzip** and **make** — needed by the image build script
- **uv** — runs the Python scripts, and installs their exact pinned dependencies for you
- **Node** — from article 2 onward. The JavaScript here has no runtime dependencies at
  all and no build step, so a recent Node is all that's needed
- **About 4 GB of free memory**, and `sudo`, which containerlab needs

Minimum versions are in `lab/README.md` inside the download below, checked at the
top of the file. They are listed there rather than here so there is one copy to keep
current.

## The image is bring-your-own

The lab devices run Cisco IOL, and **this project cannot ship it**. Cisco distributes IOL
in the reference platform ISO of CML-Free, licensed for use within CML, so this site
contains no image. You download the ISO with your own account and a script does the rest.

Getting it takes **about fifteen minutes**, most of which is to register and download the image:

1. Sign in at [developer.cisco.com/modeling-labs/cml-free/](https://developer.cisco.com/docs/modeling-labs/cml-free/)
   and get the CML-Free **reference platform ISO**. You will need a Cisco account.
2. Get the build script:

    ```sh
    curl -LO https://happypathnetworking.com/assets/releases/quelaag-before-you-start.tar.gz
    tar -xzf quelaag-before-you-start.tar.gz
    cd quelaag-before-you-start
    ```

3. Unzip the ISO into that directory — Cisco ships it inside a zip, and the `.gitignore`
   you just unpacked keeps both out of any repository you put this in:

    ```sh
    unzip /path/to/refplat-<version>-free-iso.zip -d .
    ```

4. Run the build. It extracts the IOL binary, fetches the tooling that packages it, and
   produces the container image containerlab expects:

    ```sh
    sudo ./lab/build-image.sh refplat-<version>-free.iso
    ```

    It finishes by printing `Image ready: quelaag/cisco_iol:lab`.

That's all it takes. Every article after this reuses the same image.

!!! warning "Labs will not run without this image"

    Without the ISO you
    cannot run the lab. That is a real limitation, but it doesn't block everything.

    Roughly half of the series does not require a lab:

    | Article | Runs without the lab? |
    |---------|-----------------------|
    | 1 — the lab | No. It is the lab |
    | 2 — the library | Yes, apart from the round-trip demonstration at the end |
    | 3 — the vault | Entirely |
    | 4 — the verification service | Entirely |
    | 5a, 5b — the engine | No  |
    | 6a, 6b — the receiver, and shipping it | No |

    Articles you cannot run still quote real output throughout, so nothing is hidden.

## Then

That download is the scipt to build the image and nothing else. *You will need to carry this image forward* as you go through the series since it cannot be distributed directly.

The lab it feeds — the topology, the
two device configurations, and the scripts that drive them — arrives with
[article 1](01-you-dont-need-a-rack-of-routers.md), where it is explained rather than
just handed over. From there on the lab is two commands:

```sh
./lab/up.sh          # two routers, about two minutes to boot
./lab/down.sh        # when you are done
```

The deploy itself takes seconds. The devices take a couple of minutes after that before
they answer SSH — containerlab will report them `running` well before they are usable,
which is normal and not a fault.

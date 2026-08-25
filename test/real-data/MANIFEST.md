# Real-data benchmark corpus — sources and licenses

Generated/downloaded by `scripts/fetch-real-data.ts`. This directory is
gitignored — nothing here is redistributed through this repo; regenerate
locally by running the script.

## firmware/ — real embedded firmware & kernel binaries

Source: [raspberrypi/firmware](https://github.com/raspberrypi/firmware),
the Raspberry Pi Foundation's public firmware repository — published
specifically for public download and on-device use. Used here only for
local research/benchmarking, not redistributed further.

| File | Bytes | What it is |
|---|---|---|
| `bootcode.bin` | 52,624 | GPU second-stage bootloader (proprietary Broadcom blob, publicly redistributed) |
| `fixup.dat` | 7,381 | SDRAM/GPU memory-split fixup table |
| `start.elf` | 3,022,336 | GPU firmware (VideoCore ELF image) |
| `kernel8.img` | 10,474,929 | ARM64 Linux kernel image, as shipped on real Raspberry Pi devices |

## pcap/ — real network protocol captures

Source: [Wireshark Sample Captures](https://wiki.wireshark.org/SampleCaptures),
Wireshark's official wiki — published for public download and use in
exactly this kind of testing.

| File | Bytes | Protocol |
|---|---|---|
| `http.cap` | 25,803 | HTTP |
| `dhcpv6_1.pcap` | 1,404 | DHCPv6 |
| `STP_UplinkFast.pcapng` | 1,524 | Spanning Tree Protocol |
| `sip-rtp-opus-hybrid.pcap` | 2,772 | SIP + RTP/Opus (VoIP) |

## image/ — real public-domain image (control case, outside the win zone)

Source: [NASA Image Library](https://images.nasa.gov), PIA23122 — a US
government work, public domain.

| File | Bytes |
|---|---|
| `nasa_pia23122.jpg` | 324,544 |

## prbs/ — real ITU-T O.150 PRBS test patterns

Not downloaded — generated locally from the public, standardized Fibonacci
LFSR polynomials (`x^N + x^k + 1`) that real SONET/SDH/USB/PCIe BERT
(bit-error-rate-tester) hardware implements, bit-serial and byte-packed the
way that hardware would store them. Mathematically exact, not an
approximation — see `scripts/gen-real-world-file.ts`'s header for the
correctness notes this generator was validated against (right-shift LFSR
convention, degenerate-all-zero-state guard).

| File | Order | Bytes |
|---|---|---|
| `prbs7.bin` | 7 | 131,072 |
| `prbs9.bin` | 9 | 131,072 |
| `prbs11.bin` | 11 | 131,072 |
| `prbs15.bin` | 15 | 131,072 |
| `prbs20.bin` | 20 | 131,072 |
| `prbs23.bin` | 23 | 131,072 |
| `prbs31.bin` | 31 | 131,072 |

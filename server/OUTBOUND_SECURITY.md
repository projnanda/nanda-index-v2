# Outbound IPv6 policy

`publicUrlGuard` rejects these IPv4/IPv6 transition prefixes for URL literals
and DNS answers; any blocked address rejects the entire answer set:

| Prefix | Mechanism |
| --- | --- |
| `64:ff9b::/96` | [Well-known translation prefix (RFC 6052)](https://www.rfc-editor.org/rfc/rfc6052#section-2.1) |
| `64:ff9b:1::/48` | [Local-use translation prefix (RFC 8215)](https://www.rfc-editor.org/rfc/rfc8215#section-3) |
| `2002::/16` | [6to4 (RFC 3056)](https://www.rfc-editor.org/rfc/rfc3056#section-2) |
| `2001::/32` | [Teredo (RFC 4380)](https://www.rfc-editor.org/rfc/rfc4380#section-2.6) |

Entire prefixes are denied, including encodings of public IPv4 addresses.
Native public IPv4/IPv6 checks, DNS pinning, and caller-enforced redirect refusal
are unchanged. No database migration or new configuration is required.

`OUTBOUND_ALLOW_PRIVATE_HOSTS=true` bypasses the guard for local development.
Operator-defined translation prefixes cannot be identified from address bits
alone and require deployment-specific egress restrictions.

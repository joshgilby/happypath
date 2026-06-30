---
icon: lucide/key-round
---

# Hash Verification Microservice

A microservice to validate hashes from device configurations against securely stored passwords.

## Motivation and Scope

Secrets are sensitive. Their need for secure handling presents challenges to automation. Many network automation platforms exclude managing secrets from their scope, leaving customers to find their own way. In this article, we will mock up a system to securely manage secrets, demonstrating the value of the chosen approach.

The requirements driving this demo are:

1. Secrets need to be stored securely. This requires a password vault.
2. Secrets should only be transmitted over secure communication channels.
3. Any system for managing secrets should restrict access to those secrets as much as possible.

The first two requiremens are straightforward. Firstly, the solution must include a password vault. Secondly, any remote API calls need to support SSL. Setting up SSL itself is beyond the scope of this exercise as SSL termination is well documented, but may be addressed in an update.

To simplify the code base, we will limit our demo's scope to managing local login credentials for Cisco devices. Organizations can extend this approach to apply to other sensitive configuration data, i.e. PSKs for ipsec, RADIUS, or TACACS. The local user credential also presents an interesting use case in that verifying login credentials is not trivial when TACACS is in use.

## Design

``` mermaid
graph LR
  A[Client] --> |fetch password id| B[NSoT];
  A --> |fetch hash| C[Device];
  A --> |password id and hash| D[Hash Verification];
  D --> |fetch password| E[Vault]
  D -->|result| A;
```
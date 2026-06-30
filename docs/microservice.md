---
icon: lucide/key-round
---

# Hash Verification Microservice - Core

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

### Components

**Vault**: a secure password manager. We will use the keyrings.cryptfile module, which stores encrypted passwords on the local filesystem.

**Validator**: a microservice that recieves a key ID and hash from a client, fetches the referenced password from the vault, and determines whether the hash is valid for the given password. This is the only code that can access the vault.

**Client**: a client to demonstrate how to use the microservice to validate password hashes from device configurations.

**Configuration**: the device configuration to validate. Here, we will use a configuration file on the local filesystem.

**NSoT**: identifies the password that is used for local users. We will maintain those identifiers in a nornir inventory file.

### Configuration Validation Sequence

``` mermaid
sequenceDiagram
  autonumber
  Client->>Configuration: derive username and hash
  Client->>NSoT: request password ID
  NSoT->>Client: return password ID
  Client->>Validator: send password ID and hash
  Validator->>Vault: request password
  Vault-->>Validator: return password
  Validator-->>Client: return validation status and hash
  Client->>Configuration: update hash (on failure)
```

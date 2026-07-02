---
icon: lucide/key-round
---

# Hash Verification Microservice

A microservice to validate hashes from device configurations against securely stored passwords.

## Motivation and Scope

Secrets are sensitive. Their need for secure handling presents challenges to automation. Many network automation platforms exclude managing secrets from their scope, leaving customers to find their own way. In this article, we will mock up a system to securely manage secrets, demonstrating the value of the chosen approach.

Secrets requires special handling in order to maintain their confidentiality:

1. Secrets need to be stored securely. This requires a password vault.
2. Secrets should only be transmitted over secure communication channels.
3. Any system for managing secrets should restrict access to those secrets as much as possible.

The first two requiremens are straightforward. Firstly, the solution must include a password vault. Secondly, any remote API calls need to support SSL. Setting up SSL itself is beyond the scope of this exercise, but can be addressed with a terminating proxy.

To simplify the code base, we will limit our demo's scope to managing local login credentials for Cisco devices. Organizations can extend this approach to apply to other sensitive configuration data, i.e. PSKs for ipsec, RADIUS, or TACACS. The local user credential also presents an interesting use case in that it is not trivial to verify login credentials when TACACS is in use.

## Source Code

The full source code for this workshop is available on [github](https://github.com/joshgilby/happypath). Cloning the repository will save a lot of typing (or copy-pasting).

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
```

## Implementation

We will begin by implementing the validation microservice, which we can validate using ```curl``` commands. After that, we will devlop a client script to demonstrate how to consume the service.

The file structure will look like this:

``` mermaid
treeView-beta
├── cisco-hash-microservice
│   ├── env.sh
│   ├── initdb.py
│   ├── main.py
│   └── tests.sh
├── secrets-validator
│   ├── configs
│   |   ├── r1
│   |   └── r2
│   ├── inventory
│   |   └── hosts.yaml
│   └── validate-secrets.py
```

### Initialize Vault

For the next two sections, we will be working in the *cisco-hash-microservice* directory.

The microservice fetches passwords from the vault. The vault is implemented with the keyrings.cryptfile module. We need to initialize the vault prior to implementing the microservice.

In a bash shell, run ```source env.sh``` to load the keyring configuration into your environment.

``` bash title="env.sh"
export KEYRING_CRYPTFILE_PASSWORD=foobar
```

Then run the ```initdb.py``` script below to initialize the keyring. The keyrings.cryptfile module identifies passwords with a service name and user name. Here, we create a password for the *localuser* user on the *router* service. The password itself is *weakpassword*.

``` py title="initdb.py" linenums="1"
from keyrings.cryptfile.cryptfile import CryptFileKeyring
import os

kr=CryptFileKeyring()
cryptfile_password=os.getenv("KEYRING_CRYPTFILE_PASSWORD")
kr.keyring_key=(cryptfile_password)
kr.set_password("router", "localuser", "weakpassword")
```

That's it! We now have a password in the vault to verify against.

### Implement Microservice

Our microservice is implemented using the fastapi web framework. Secrets are stored using keyrings.cryptfile. The cisco_hashgen.cli module provides functions to verify and generate password hashes. We only need to import these dependnciesm and add a few lines of code:

``` py title="main.py" linenums="1"
from fastapi import FastAPI
from keyrings.cryptfile.cryptfile import CryptFileKeyring
import cisco_hashgen.cli
import os

app = FastAPI()
kr=CryptFileKeyring()
cryptfile_password=os.getenv("KEYRING_CRYPTFILE_PASSWORD")
kr.keyring_key=(cryptfile_password)

@app.get("/")
async def root(username: str, service: str, password_hash: str):
    password=kr.get_password(service, username)
    result={}
    if cisco_hashgen.cli.verify_password (password, password_hash):
        result['status']='pass'
        result['hash']=password_hash
    else:
        result['status']='fail'
        result['hash']=cisco_hashgen.cli.build_ios_type8(password=bytes(password, "ascii"))
    return result

```

Lines 1-9 import dependencies and initialize the needed objects.

Line 11 instructs fastapi to route GET requests for the server root to the ```root``` function.

Lines 12-21 implement the main functionality. It queries the vault for a password identified by the username and service arguments, checks whether the hash argument is valid for the password, and returns the validation result to the client. If the hash is valid, the service returns a status of *pass* and includes the input hash, unchanged. Otherwise, it returns a *fail* status and includes a newly-generated, valid hash. We'll see how the client uses these later.

You can now launch the microservice with the ```fastapi dev``` command. The service will bind to the localhost IP address, 127.0.0.1, and will automatically reload if ```main.py``` changes. For production, use ```fastapi run```.

!!! tip

    Launch fastapi from the directory that contains ```main.py```.

When the service launches, fastapi should produce output similar to:

```
(venv) jgilby@jsurf11:~/projects/mockups/cisco-hash-microservice$ fastapi dev

   FastAPI   Starting development server 🚀
 
             Searching for package file structure from directories with __init__.py files
             Importing from /home/jgilby/projects/mockups/cisco-hash-microservice
 
      code   Importing the FastAPI app object from the module with the following code:
 
             from main import app
 
       app   Using import string: main:app
 
      info   Configuration sources:
              • Import string: entrypoint in pyproject.toml
 
    server   Server started at http://127.0.0.1:8000
    server   Documentation at http://127.0.0.1:8000/docs
 
       tip   Running in development mode, for production use: fastapi run
 
             Logs:
 
      INFO   Will watch for changes in these directories: ['/home/jgilby/projects/mockups/cisco-hash-microservice']
      INFO   Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
      INFO   Started reloader process [232371] using WatchFiles
      INFO   Started server process [232499]
      INFO   Waiting for application startup.
      INFO   Application startup complete.
```

The microservice is now running and ready to process requests. Use the curl commands in tests.sh to validate that it works as expected:

``` bash title="tests.sh"
curl 'http://localhost:8000/?username=localuser&service=router&hash=$9$UK9FYKZUD.n94E$qcLQeaiNaUjVj181Q8Hh2cUya7qdMV4q.qszxl3H0Ha' # should fail, returning new hash
curl 'http://localhost:8000/?username=localuser&service=router&hash=$8$LkGlosq.R44sx.$VLpv7K56GEx6jhU4aMKgsGXvMo1n1EE/fElkbpJXQfY' # should pass, returning the original hash
```

If the first test fails, and the second test passes, the microservice is functional and we can move to the client.

### Initialize Device Configuration and Source of Truth

To implement the client side, change to the *secrets-validator* directory.

The validation script fetches device configurations from the *configs* directory, and uses *inventory/hosts.yaml* as its source of truth:

``` title="configs/r1"
username localuser privilege 15 secret 8 $8$be6NbC1TntHC6E$S8XxiiHUGFtMgA3zyP5Maiq/7FSI3JrbMRTiLVME73A
```

``` title="configs/r2"
username localuser privilege 15 secret 8 $8$JOcpQMJFctsq7.$I1UhdjAJbm9zk4T3h2CdQmbyFzFQAxlwncQQD15S.Ck
```

``` title="inventory/hosts.yaml"
---
r1:
  data:
    localusers:
      - localuser

r2:
  data:
    localusers:
      - localuser
```

Verify that these files are in place and proceed with the client implementation.

### Implement Client

A service isn't much use without a client to consume it. Our client will use the nornir automation framework. Nornir provides an inventory, which we will use to manage the user names configured on each router. It also dispatches tasks per device and aggregates the results from each task and device.

``` py title="validate-secrets.py" linenums="1"
from nornir import InitNornir
from nornir.core.task import Task, Result
from nornir_utils.plugins.functions import print_result
import pprint

import requests

# Initialize nornir
nr = InitNornir(
    inventory={
        "plugin":"SimpleInventory",
        "options": {
            "host_file": "inventory/hosts.yaml"
        }
    }
)

def get_facts(task:Task) -> Result:
    task.host.data['f_users']={}
    with open(f"configs/{task.host.name}", "r") as file:
        for i in file:
            splitline=i.rstrip().split(" ")
            task.host.data['f_users'][splitline[1]]=splitline[6]
    msg=pprint.pformat(task.host.data['f_users'])
    return Result(
        host=task.host,
        result=msg
    )
 
def get_truth(task:Task) -> Result:
    task.host.data['t_users']={}
    for i in task.host.data['localusers']:
        hash=''
        if i in task.host.data['f_users']:
            hash=task.host.data['f_users'][i]
        url=f"http://localhost:8000/?username={i}&hash={hash}&service=router"
        r=requests.get(url)
        task.host['t_users'][i]=r.json()['hash']
    return Result(
        host=task.host,
        result=task.host.data['t_users']
    )

def generate_artifact(task:Task) -> Result:
    task.host.data['artifact']=[]
    for i in task.host['f_users']:
        if i in task.host['t_users']:
            if task.host['t_users'][i]==task.host['f_users'][i]:
                del(task.host['t_users'][i])
        else:
            task.host.data['artifact'].append(f"no username {i}")
    for i in task.host['t_users']:
        task.host.data['artifact'].append(f"username {i} privilege 15 secret 8 {task.host['t_users'][i]}")
    return Result(
        host=task.host,
        result=task.host.data['artifact']
    )

# Define a task
def some_task(task:Task) -> Result:
    task.run(task=get_facts)
    task.run(task=get_truth)
    task.run(task=generate_artifact)
    return Result(
        host=task.host,
    )

# Execute the task
result=nr.run(task=some_task)
print_result(result)
```

After importing dependencies and initializing nornir, we define four tasks:

1. ```get_facts()``` gathers user names and hashes from the router's configuration.
2. ```get_truth()``` computes the intended user names and hashes. This is the point of the client. It fetches intended user names from the inventory. If an intended user exists in the result of get_facts(), we validate the hash.
3. ```generate_artifact()``` compares the output of get_facts() with the output of get_truth(). For any discrepancies it builds the commands to deploy the intended configuration to the router.
4. ```some_task()``` runs the previous three tasks against a device.

!!! tip

    Notice that ```some_task()``` is invoked with ```nr.run()```. This runs the selected task against all hosts in the inventory. On the other hand, we call ```task.run()``` to invoke the other tasks from within ```some_task()``` and only affects the host that is being processed by the parent task.

Finally, we instruct nornir to run ```some_task()``` against every device in the inventory and print the result. Here is the expected output from running the client:

```
some_task***********************************************************************
* r1 ** changed : False ********************************************************
vvvv some_task ** changed : False vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv INFO
---- get_facts ** changed : False ---------------------------------------------- INFO
{'localuser': '$8$be6NbC1TntHC6E$S8XxiiHUGFtMgA3zyP5Maiq/7FSI3JrbMRTiLVME73A'}
---- get_truth ** changed : False ---------------------------------------------- INFO
{'localuser': '$8$pu68dNxCpIJgLU$.Gb4fYbUh1n6RkfYQHsGckEjsYwdX4jEodvysw3HzzM'}
---- generate_artifact ** changed : False -------------------------------------- INFO
[ 'username localuser privilege 15 secret 8 '
  '$8$pu68dNxCpIJgLU$.Gb4fYbUh1n6RkfYQHsGckEjsYwdX4jEodvysw3HzzM']
^^^^ END some_task ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
* r2 ** changed : False ********************************************************
vvvv some_task ** changed : False vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv INFO
---- get_facts ** changed : False ---------------------------------------------- INFO
{'localuser': '$8$JOcpQMJFctsq7.$I1UhdjAJbm9zk4T3h2CdQmbyFzFQAxlwncQQD15S.Ck'}
---- get_truth ** changed : False ---------------------------------------------- INFO
{'localuser': '$8$JOcpQMJFctsq7.$I1UhdjAJbm9zk4T3h2CdQmbyFzFQAxlwncQQD15S.Ck'}
---- generate_artifact ** changed : False -------------------------------------- INFO
^^^^ END some_task ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

The script produces two aggregated results, one for each router. The aggregated result for r1 shows us that the results of get_facts and get_truth do not match, so the script build a configuration artifact. For r2, however, get_facts and get_truth do match, so no configuration artifact is needed.

## Conclusion

The hash verification microservice effectively limits the exposure of managed secrets while facilitating the validateion of password hashes stored in device configurations. While not suitable for production, this exercise proves the premise's feasability and value. We will add functionality to this system in upcoming articles.

Happy automating!

from nornir import InitNornir
from nornir.core.task import Task, Result
from nornir_utils.plugins.functions import print_result
from pprint import pformat
import requests

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
    msg=pformat(task.host.data['f_users'])
    return Result(
        host=task.host,
        result=msg
    )
 
def get_truth(task:Task) -> Result:
    task.host.data['t_users']={}
    for i in task.host.data['localusers']:
        password_hash=''
        if i in task.host.data['f_users']:
            password_hash=task.host.data['f_users'][i]
        url=f"http://localhost:8000/?username={i}&password_hash={password_hash}&service=router"
        r=requests.get(url)
        task.host.data['t_users'][i]=r.json()['hash']
        msg=pformat(task.host.data['t_users'])
    return Result(
        host=task.host,
        result=msg
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

def all_the_tasks(task:Task) -> Result:
    task.run(task=get_facts)
    task.run(task=get_truth)
    task.run(task=generate_artifact)
    return Result(
        host=task.host,
    )

result=nr.run(task=all_the_tasks)
print_result(result)

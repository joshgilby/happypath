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

from keyrings.cryptfile.cryptfile import CryptFileKeyring
import os

kr=CryptFileKeyring()
cryptfile_password=os.getenv("KEYRING_CRYPTFILE_PASSWORD")
kr.keyring_key=(cryptfile_password)
kr.set_password("router", "localuser", "weakpassword")

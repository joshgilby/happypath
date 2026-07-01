# cisco-hash-microservice

Microservice to verify password hashed from Cisco devices. The service implements an API that:
1. receives a service, username, and password hash as input, 
2. fetches the corresponding password from a password store
3. verifies whether the password and hash match
4. on success, returns the original hash, on failure returns a new hash of the password

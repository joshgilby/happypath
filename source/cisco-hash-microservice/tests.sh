curl 'http://localhost:8000/?username=localuser&service=router&hash=$9$UK9FYKZUD.n94E$qcLQeaiNaUjVj181Q8Hh2cUya7qdMV4q.qszxl3H0Ha' # should fail, returning new hash
curl 'http://localhost:8000/?username=localuser&service=router&hash=$8$LkGlosq.R44sx.$VLpv7K56GEx6jhU4aMKgsGXvMo1n1EE/fElkbpJXQfY' # should pass, returning test hash

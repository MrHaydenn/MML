"""Temporary local MMSM for the real Electron pairing integration check."""
import contextlib
import hashlib
import json
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import time
sys.path.insert(0,sys.argv[1])
from mmsm.store import Store
from mmsm.manager import Manager
from mmsm.web import WebServer, Handler

Handler.log_message=lambda *args:None
with tempfile.TemporaryDirectory(prefix='mml-mmsm-check-') as directory:
    store=Store(directory)
    manager=Manager(store,start_background=False)
    web=WebServer(('127.0.0.1',0),manager)
    user=store.add_user('LauncherDemo',secrets.token_urlsafe(32),'owner',first=True)
    token='mml_pair_'+secrets.token_urlsafe(32)
    store.execute('INSERT INTO launcher_pairings VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user['id'],time.time()+600))
    thread=threading.Thread(target=web.serve_forever,daemon=True);thread.start()
    print(json.dumps({'instanceUrl':f'http://127.0.0.1:{web.server_port}','token':token}),flush=True)
    try:sys.stdin.readline()
    finally:
        web.shutdown();web.server_close();thread.join();manager.close();store.db.close()

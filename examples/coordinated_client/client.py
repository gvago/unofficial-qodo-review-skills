"""Load coordinated service contracts and prepare requests without network I/O."""
import json
from pathlib import Path


def prepare_request(name, settings_path):
    settings = json.loads(Path(settings_path).read_text())
    contract = settings["contracts"][name]
    return contract["method"], contract["path"], {}, settings["service_config"]

# Vendored from Beat This! 1.1.0 (https://github.com/CPJKU/beat_this, commit b95c8ab),
# function replace_state_dict_key from beat_this/utils.py. MIT license: see
# setvector/models/LICENSE-beat-this.


def replace_state_dict_key(state_dict: dict, old: str, new: str):
    """Replaces `old` in all keys of `state_dict` with `new`."""
    keys = list(state_dict.keys())  # take snapshot of the keys
    for key in keys:
        if old in key:
            state_dict[key.replace(old, new)] = state_dict.pop(key)
    return state_dict

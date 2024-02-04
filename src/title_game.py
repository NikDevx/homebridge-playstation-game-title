import json
import sys

from psnawp_api import PSNAWP

psnawp = PSNAWP(sys.argv[1])
client = psnawp.me()


def user_status():
    sys_argvs = sys.argv
    del sys_argvs[0:2]
    accounts_id = sys_argvs[0].replace('["', '').replace('"]', '').replace('"', '')
    accounts_ids = accounts_id.split(',')

    game_id = "CUSAXXXXXX"
    game_title = "Loading..."

    for user in accounts_ids:
        user_name = psnawp.user(account_id=user).account_id
        user_info = psnawp.user(account_id=user).get_presence()
        if user_info["basicPresence"]["primaryPlatformInfo"]["onlineStatus"] == "online" and user == user_name:
            if "gameTitleInfoList" in user_info["basicPresence"]:
                game_id = user_info["basicPresence"]["gameTitleInfoList"][0]["npTitleId"]
                game_title = user_info["basicPresence"]["gameTitleInfoList"][0]["titleName"]
            else:
                game_title = "Not playing"

    return game_title


print(user_status())

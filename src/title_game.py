import json
import sys

from psnawp_api import PSNAWP
from psnawp_api.core import psnawp_exceptions

try:
    PSNAWP(sys.argv[1])
except psnawp_exceptions.PSNAWPAuthenticationError as e:
    psnawp = False
    psnawp_code = "Your npsso code has expired or is incorrect. Please generate a new code!"
else:
    psnawp = PSNAWP(sys.argv[1])
    client = psnawp.me()


def user_status():
    sys_argvs = sys.argv
    del sys_argvs[0:2]
    accounts_id = sys_argvs[0].replace('["', '').replace('"]', '').replace('"', '')
    accounts_ids = accounts_id.split(',')

    game_id = "CUSAXXXXXX"
    game_title = "Loading..."

    if psnawp:
        for user in accounts_ids:
            user_name = psnawp.user(account_id=user).account_id
            user_info = psnawp.user(account_id=user).get_presence()
            if user == user_name:
                if user_info["basicPresence"]["primaryPlatformInfo"]["onlineStatus"] == "online":
                    if "gameTitleInfoList" in user_info["basicPresence"]:
                        game_id = user_info["basicPresence"]["gameTitleInfoList"][0]["npTitleId"]
                        game_title = user_info["basicPresence"]["gameTitleInfoList"][0]["titleName"]
                    else:
                        game_title = "Not playing"
                else:
                    game_title = "Offline status"
    else:
        if psnawp_code == "Your npsso code has expired or is incorrect. Please generate a new code!":
            game_title = "NPSSO code has expired or incorrect! Replace it!"
        else:
            game_title = "Something went wrong while authenticating!"

    return game_title


print(user_status())
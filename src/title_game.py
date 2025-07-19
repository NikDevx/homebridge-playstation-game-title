import json
import sys
import traceback
from psnawp_api import PSNAWP
from psnawp_api.core import psnawp_exceptions


def main():
    try:
        psnawp = PSNAWP(sys.argv[1])
    except psnawp_exceptions.PSNAWPAuthenticationError:
        print("Console offline")
        sys.exit(1)

    try:
        sys_argvs = sys.argv
        account_ids_raw = sys_argvs[2].replace('["', '').replace('"]', '').replace('"', '')
        account_ids = account_ids_raw.split(',')

        for account_id in account_ids:
            try:
                user = psnawp.user(account_id=account_id)
                presence = user.get_presence()

                if presence["basicPresence"]["primaryPlatformInfo"]["onlineStatus"] != "online":
                    continue

                if "gameTitleInfoList" in presence["basicPresence"]:
                    title = presence["basicPresence"]["gameTitleInfoList"][0]["titleName"]
                    print(title[:63])
                    return
                else:
                    print("Not playing")
                    return

            except psnawp_exceptions.PSNAWPTooManyRequests:
                print("Console offline")
                return
            except Exception as e:
                print("Console offline")
                return

        print("Console offline")

    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print("Console offline")
        sys.exit(1)


if __name__ == "__main__":
    main()

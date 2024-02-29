from rcon import MCRcon
import sys

temp = sys.argv[1]
server, port, password, func = temp.split(',')
port = int(port)


def main(func):
    global server, port, password
    with MCRcon(server, password, port) as mcr:
            resp = mcr.command(func)
            return resp


print(main(func))

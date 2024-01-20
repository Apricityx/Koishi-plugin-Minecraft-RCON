from rcon import MCRcon
import sys

temp = sys.argv[1]
server, port, password, func, arg = temp.split(',')
port = int(port)


def main(func, args):
    global server, port, password
    if func == 'list':
        return get_list()
    elif func == 'say':
        return say(args)
    elif func == 'whitelist':
        return whitelist(args)
    elif func == 'whitelist_remove':
        return whitelist_remove(args)
    elif func == 'run_command':
        return run_command(args)
    else:
        return 'Unknown command'


def get_list():
    with MCRcon(server, password, port) as mcr:
        resp = mcr.command('/list')
        return resp


def say(arg):
    with MCRcon(server, password, port) as mcr:
        resp = mcr.command('/say ' + arg)
        return resp


def whitelist(arg):
    with MCRcon(server, password, port) as mcr:
        resp = mcr.command('/whitelist add ' + arg)
        return resp


def whitelist_remove(arg):
    with MCRcon(server, password, port) as mcr:
        resp = mcr.command('/whitelist remove ' + arg)
        return resp


def run_command(arg):
    with MCRcon(server, password, port) as mcr:
        resp = mcr.command(arg)
        return resp


print(main(func, arg))

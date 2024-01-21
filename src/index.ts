// noinspection TypeScriptValidateJSTypes

import {Context, Schema} from 'koishi'
import {spawn} from 'child_process'

export const name = 'minecraft-rcon-command'

export interface Config {

}

export const Config: Schema<Config> = Schema.object({
    servers: Schema.array(Schema.object({
        name: Schema.string().description('服务器名称').default('114514'),
        address: Schema.string().description('服务器地址').default('127.0.0.1'),
        password: Schema.string().description('RCON密码').default('password'),
        port: Schema.number().description('RCON端口').default(25575),
    })).role('table').default([{address: '127.0.0.1', password: 'password', port: 25575, name: '114514'}]),
    debug: Schema.boolean().description('是否启动调试模式').default(false),
    timeout: Schema.number().description('超时时间(s)').default(10),
    path: Schema.string().description('python脚本路径(一般不需要动)').default('/node_modules/koishi-plugin-minecraft-rcon-command/lib/Minecraft-Rcon/main.py'),
    vote_server: Schema.string().description('投票指令执行的服务器的序号（上边的servers的序号，从0开始）').default('0'),
    vote_timeout: Schema.number().description('投票持续时间(s)').default(100),
    vote_max: Schema.number().description('几人投票视为通过').default(3),
    group: Schema.array(Schema.string()).description('允许使用的群号').default([]),
})

export function apply(ctx: Context, config: Config) {
    //https://gitee.com/apricityx/Minecraft-RCON.git
    let member = []
    const group = config['group']
    const vote_max = parseInt(config['vote_max'])
    const order = parseInt(config['vote_server'])
    const ifDebug = config['debug']
    const logger = ctx.logger('Debug')
    let time_counter: number = parseInt(config['vote_timeout'])
    const timeout = config['timeout']

    function debug(text: any) {
        if (ifDebug)
            logger.success(text)
    }

    //执行py脚本中的hello函数

    const servers = config['servers']
    debug('从配置文件中获取：' + servers.length + '个服务器')

    async function run(command: string, args: string, server: any, server_name: string) {
        let temp = ''
        let data = server + ',' + command + ',' + args
        let path = ctx.baseDir + config['path']
        debug('正在当前目录寻找python脚本：' + path)
        const python = spawn('python', [path, data])
        // 捕获控制台输出对象stdout
        python.stdout.on('data', function (data) {
            debug('python输出: ' + data.toString())
            temp = data.toString()
        })
        // 捕获控制台输出对象stderr
        python.stderr.on('data', function (data) {
            debug('python出错: ' + data.toString())
        })
        let n = config['timeout']
        while (temp == '' && n != 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            n--
            if (n == 0) {
                debug(server_name + '服务器未响应，请检查服务器是否开启')
                temp = '服务器炸了'
            }
        }
        return server_name + ': ' + temp
    }

    let server = servers[0]

    ctx.command('!!whitelist <method> <player>')
        .action(async ({session}, method, player) => {
            for (server in servers) {
                server = servers[server]
                let address = server['address']
                let port = server['port']
                let password = server['password']
                let name = server['name']
                let origin = address + ',' + port + ',' + password
                debug('已连接至服务器' + origin)
                debug('尝试将玩家 ' + player + ' 加入' + '服务器：' + origin + '白名单')

                // 调用py脚本
                // 实现py脚本打印值后，再将值赋值给resp，再将resp返回给用户
                // 避免resp的值为空
                if (method != 'add' && method != 'remove') {
                    await session.send('请输入正确的指令')
                    return
                }
                if (player == null) {
                    await session.send('请输入玩家名')
                    return
                }
                if (method == 'add') {
                    let resp = await run('whitelist', player, origin, name)
                    debug(resp)
                    session.send(resp).then(() => {
                        debug('已尝试将玩家 ' + player + ' 加入白名单')
                    })
                }
                if (method == 'remove') {
                    let resp = await run('whitelist_remove', player, origin, name)
                    debug(resp)
                    session.send(resp).then(() => {
                        debug('已尝试将玩家 ' + player + ' 移出白名单')
                    })
                }
            }
        })

    ctx.command('!!online')
        .action(async ({session}) => {
            debug('尝试查看在线人数')
            for (server in servers) {
                server = servers[server]
                let address = server['address']
                let port = server['port']
                let password = server['password']
                let name = server['name']
                let origin = address + ',' + port + ',' + password
                let resp = await run('list', '', origin, name)
                session.send(resp).then(() => {
                    debug('已查看在线人数')
                })
            }
        })
    let vote = 0
    ctx.command('!!run <arg:text>')
        .action(async ({session}, arg: string) => {
            debug('尝试发起投票')
            if (arg == null) {
                session.send('发起方法：!!run [指令]')
                return
            }
            if ('/' == arg[0]) {
                if (vote != 0) {
                    session.send('当前已有人发起投票，无法再次发起\n使用!!vote yes/no 进行投票')
                    return
                }
                if (group.indexOf(session.event.channel.id.toString()) == -1) {
                    session.send('发起投票失败，此群不在允许使用的群列表中，别干坏事哦')
                    debug('发起投票失败，原因：此群不在允许使用的群列表中，群聊：' + session.event.channel.id + '当前允许的群聊：' + group)
                    return;
                }
                vote = 1
                time_counter = parseInt(config['vote_timeout'])
                debug("条件满足，已发起投票")
                member.push(session.user)
                server = servers[order]
                let address = server['address']
                let port = server['port']
                let password = server['password']
                let name = server['name']
                let origin = address + ',' + port + ',' + password
                let result = await if_vote_result({session}, arg)
                if (result == 'timeout') {
                    session.send('投票超时，投票已取消')
                }
                if (result == 'pass') {
                    let resp = await run('run_command', arg, origin, name)
                    session.send(resp).then(() => {
                        debug('已执行指令：' + arg)
                    })
                }
                if (result == 'fail') {
                    session.send('投票被一票否决')
                }
                if (result == 'cancel') {
                    session.send('投票被取消')
                }
                vote = 0
                member = []
                debug('投票结束，已初始化人员与投票数')
            } else {
                session.send('指令需要用/开头')
            }
        })

    ctx.command('!!vote <arg:text>')
        .action(({session}, arg) => {
            if (arg == 'help') {
                session.send('!!run [指令] 发起投票\n!!vote yes/no 进行投票\n!!vote cancel 取消投票')
                return
            }
            if (arg == 'cancel') {
                vote = -2
                session.send("投票被取消")
                return;
            }
            if (group.indexOf(session.event.channel.id.toString()) != -1) { //判断是否是可用的群聊
                if (member.indexOf(session.user) == -1) { //判断用户是否投过票
                    member.push(session.user)
                    if (vote == 0) {
                        session.send('当前无人发起指令投票\n请使用!!run [指令] 发起投票')
                        return
                    }
                    if (arg == 'yes') {
                        vote++
                        time_counter = config['timeout']
                        debug('同意票 +1，重置倒计时')
                    }
                    if (arg == 'no') {
                        vote = -1
                        debug('投票被一票否决')
                    }
                    if (arg != 'yes' && arg != 'no') {
                        session.send('请输入!!vote yes或!!vote no')
                    }
                } else {
                    debug('投票失败，原因：已经投过票了')
                    session.send('你已经投过票了')
                }
            } else {
                session.send('此群不在允许使用的群列表中，别干坏事哦')
                vote = -2
                debug('投票失败，原因：此群不在允许使用的群列表中，群聊：' + session.event.channel.id + '当前允许的群聊：' + group)
                return;
            }
        })

    async function if_vote_result({session}, arg) {
        let vote_change = 0
        while (1) {
            if (vote >= vote_max) {
                session.send('投票通过！正在执行指令：' + arg)
                return 'pass'
            }
            if (vote == -2) {
                return 'cancel'
            }
            if (vote == -1) {
                return 'fail'
            }
            if (vote_change != vote) {
                vote_change = vote
                session.send('已发起投票，是否决定运行指令' + arg + '\n投票进度：' + vote + '/' + vote_max + '\n使用!!vote yes/no 进行投票')
            }
            time_counter--
            if (time_counter == 0) {
                return 'timeout'
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}



// noinspection TypeScriptValidateJSTypes

import {spawn} from 'child_process'
import {Context, Schema} from 'koishi'

export const name = 'minecraft-rcon-command'
var __session_now
var stop_flag = false

export function apply(ctx: Context, config: Config) {
    var __selecting = false
    ctx.middleware((session, next) => {
        __session_now = session
    })
    const ifDebug = config['debug']
    const servers = config['servers']
    const path = config['path']
    const logger = ctx.logger('minecraft-rcon-command')
    const connection_timeout = config['connection_timeout']
    const wait_timeout = config['select_timeout']

    function debug(text: any) {
        if (ifDebug)
            logger.success(text)
    }

    debug("启动完成！")
    debug('从配置文件中获取：' + servers.length + '个服务器')
    debug('服务器为:' + servers.map((server: any) => server.name).join(','))

    async function send_command(command: string, args: string, server: any) {
        debug("服务器的信息为：" + JSON.stringify(server))
        if (!command.startsWith('/')) {
            command = '/' + command
        }
        debug('尝试发送指令' + command + '到服务器：' + server.name)
        let path = ctx.baseDir + config['path']
        debug('python脚本路径为：' + path)
        let data = server.address + ',' + server.port + ',' + server.password + ',' + command
        let output = ''
        const python = spawn('python', [path, data]) // data需要满足的值为：server,port,password,command,arg
        python.stdout.on('data', function (data) {
            debug('python输出: ' + data.toString())
            output = data.toString()
        })
        // 捕获控制台输出对象stderr
        python.stderr.on('data', function (data) {
            debug('python出错: ' + data.toString())
            output = data.toString()
        })
        // 注册子进程关闭事件
        python.on('exit', function (code, signal) {
            debug('python子进程关闭, 退出码: ' + code)
        })
        let counter = connection_timeout
        while (output === '' && counter > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            counter -= 1
            if (counter === 0) {
                debug(server.name + ' 连接超时')
                return '连接超时'
            }
        }
        return output
    }

    async function select_server(servers: any, {session}) {
        if (__selecting) {
            session.send('正在选择服务器，请稍后')
            return -1
        }
        __selecting = true
        let server_list = servers.map((server: any) => server.name)
        let data = '请选择服务器：\n' + server_list.map((server: any, index: number) => '[' + index + '] ' + server).join('\n')
        session.send(data)
        let counter = wait_timeout
        let server_num = -1
        let message_now = ''
        while (server_num === -1 && counter > 0) {
            // debug('当前信息：' + JSON.stringify(__session_now))
            await new Promise(resolve => setTimeout(resolve, 1000))
            if (stop_flag) {
                __selecting = false
                stop_flag = false
                session.send('选择已取消')
                return -1
            }
            if (__session_now === undefined) {
                continue
            } else {
                message_now = __session_now.content
            }

            counter -= 1
            if (counter === 0) {
                session.send('选择超时')
                __selecting = false
                return -1
            }
            let server_list_num: string[] = []
            for (let i = 0; i < server_list.length; i++) {
                server_list_num.push(i.toString())
            }

            if (message_now in server_list_num) {
                __selecting = false
                session.send(<>
                    <at id={session.userId}/>
                    {'选择了服务器：' + servers[parseInt(message_now)].name + ' 请稍后...'}
                </>)
                return parseInt(message_now)
            }
        }
    }

    ctx.command('!!stop').action(({session}) => {
        if (__selecting) {
            stop_flag = true
            debug('满足条件，停止选择')
            return
        } else {
            debug('不满足停止选择条件')
        }
    })
    ctx.command('!!test').action(async ({session}) => {
        let data = ''
        for (let temp in config) {
            if (temp === 'servers') {
                data = data + 'servers: ' + JSON.stringify(servers) + '\n'
            } else {
                data = data + temp + ': ' + config[temp] + '\n'
            }
        }
        await session.send('当前配置项如下：\n' + data + '\n')
        // await session.send(await send_command('/list', '', servers[0]))
        let server_num = await select_server(servers, {session})
        if (server_num === -1) return
        // debug('选择服务器完成' + '选择的服务器为：' + servers[server_num].name)

    })
}

export interface Config {
}

export const Config: Schema<Config> = Schema.object({
    servers: Schema.array(Schema.object({
        name: Schema.string().description('服务器名称').default('114514'),
        address: Schema.string().description('服务器地址').default('127.0.0.1'),
        password: Schema.string().description('RCON密码').default('password'),
        port: Schema.number().description('RCON端口').default(25575),
    })).role('table').default([{address: '127.0.0.1', password: 'password', port: 25575, name: '114514'}]),
    connection_timeout: Schema.number().description('与RCON连接超时时间(s)').default(60),
    select_timeout: Schema.number().description('选择服务器超时时间(s)').default(100),
    path: Schema.string().description('python脚本路径(一般不需要动)').default('/node_modules/koishi-plugin-minecraft-rcon-command/lib/Minecraft-Rcon/main.py'),
    debug: Schema.boolean().default(false)
})

/*
* @Author: zhangyu
* @Date:   2021-12-25 17:32:41
* @Last Modified by:   zhangyu
* @Last Modified time: 2022-06-17 16:34:25
* @Email: zhangyu6936@fiberhome.com
*/

const fs = require("fs");
const path = require('path');
const readline = require('readline');

/**
 * 获取windows上的文件目录以及文件列表信息
 * @param localDir - 本地路径
 * @param dirs - 目录列表
 * @param files - 文件列表
 */
function getFileAndDirList(localDir, dirs, files) {
	const dir = fs.readdirSync(localDir);
	for (let i = 0; i < dir.length; i++) {
		const p = path.join(localDir, dir[i]);
		const stat = fs.statSync(p);
		if (stat.isDirectory()) {
			dirs.push(p);
			getFileAndDirList(p, dirs, files);
		} else {
			files.push(p);
		}
	}
}

/**
 * 时间格式化函数
 * @return {[string]} [demo:2021-12-25-17:28:55]
 */
function getTimeSlot() {
	const date = new Date((new Date()).getTime()),
		Y = date.getFullYear() + '-';
	M = (date.getMonth() + 1 < 10 ? '0' + (date.getMonth() + 1) : date.getMonth() + 1) + '-';
	D = (date.getDate() < 10 ? '0' + date.getDate() : date.getDate()) + '-';
	h = (date.getHours() < 10 ? '0' + date.getHours() : date.getHours()) + ':';
	m = (date.getMinutes() < 10 ? '0' + date.getMinutes() : date.getMinutes()) + ':';
	s = (date.getSeconds() < 10 ? '0' + date.getSeconds() : date.getSeconds());

	return Y + M + D + h + m + s;
};

/**
 * 控制台，在同一行输出日志信息
 * @param  {[string]} str [待输出的日志]
 * @param  {[boolean]} isMutiLineMode [是否换行输出]
 */
function stdout(str, isMutiLineMode) {
	// 删除光标所在行
	!isMutiLineMode && readline.clearLine(process.stdout);
	// 移动光标到行首
	!isMutiLineMode && readline.cursorTo(process.stdout, 0);
	// 输出到控制台
	if(Object.prototype.toString.call(str) === '[object String]') process.stdout.write(str);
	if(Object.prototype.toString.call(str) === '[object Object]') process.stdout.write(JSON.stringify(str));
}

/**
 * 创建本地文件
 * @param  {String} dir      本地目录
 * @param  {String} content  文件内容
 * @param  {String} fileName 文件名字
 * @return {void}
 */
function createLocalFile(dir, content, fileName) {
	const localFile = `${dir)}\\${fileName}`;
	// 先删除，再创建
	if (fs.existsSync(localFile)) {
		fs.unlinkSync(localFile);
	}

	const fsCmdFile = fs.createWriteStream(localFile);
	// 写入内容
	fs.appendFileSync(localFile, content, "utf8");
	// 关闭写入流
	fsCmdFile.end();
}

/**
 * 输出帮助信息
 * @return {[string]}     [帮助信息字符串]
 */
function getHelpInfo(cmd) {
	return `npm ${JSON.parse(process.env.npm_config_argv)["cooked"].join(" ")} : command not found\nusage: npm run deploy [<options>]

Config
     --force         Forced deploy
Scene
     --log             List update logs
     --revert          Fallback to previous version

`;
}

module.exports = {
	stdout,
	getTimeSlot,
	getFileAndDirList,
	createLocalFile,
	getHelpInfo
}
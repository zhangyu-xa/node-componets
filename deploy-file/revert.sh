# @Author: zhangyu
# @Date:   2021-12-26 16:35:29
# @Last Modified by:   zhangyu
# @Last Modified time: 2021-12-26 23:08:42
#!/bin/bash

dir=$(ls -l ./ |awk '/^d/ {print $NF}'|grep -i $1-)

dirArr=($dir)

dirArrSort=($(
   for i in "${dirArr[@]}"
   do
      echo "$i"
   done | sort -r
))

targetDir="${dirArrSort[$2]}"

rm -rf $1

mv -f $targetDir $1

exit

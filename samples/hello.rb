# Ruby: あいさつ・合計・FizzBuzz
# 実行: ruby hello.rb

puts "こんにちは、Ruby!"

sum = (1..10).sum
puts "1から10の合計: #{sum}"

(1..15).each do |i|
  if i % 15 == 0
    puts "FizzBuzz"
  elsif i % 3 == 0
    puts "Fizz"
  elsif i % 5 == 0
    puts "Buzz"
  else
    puts i
  end
end

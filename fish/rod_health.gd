extends Node2D

var max_rod_life := 100
var rod_life := max_rod_life

var min_damage := 4
var max_damage := 8

func _ready():
	randomize()
	reset_rod()

func take_damage():
	var damage = randi_range(min_damage, max_damage)
	rod_life -= damage

	print("Rod damaged! -", damage, " Life:", rod_life)

	if rod_life <= 0:
		game_over()


func reset_rod():
	rod_life = max_rod_life
	print("Rod fully repaired:", rod_life)

func game_over():
	print("ROD BROKE :( GAME OVER")
	await get_tree().create_timer(1.5).timeout
	restart_game()

func restart_game():
	get_tree().reload_current_scene()
